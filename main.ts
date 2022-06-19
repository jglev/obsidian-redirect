import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	FuzzySuggestModal,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";

type SuggestionObject = {
	alias: string;
	path: string;
	originPath: string;
	isAlias: boolean;
};

interface RedirectPluginSettings {
	limitToNonMarkdown: boolean;
	triggerString: string;
}

const DEFAULT_SETTINGS: RedirectPluginSettings = {
	limitToNonMarkdown: true,
	triggerString: "r[",
};

export default class RedirectPlugin extends Plugin {
	settings: RedirectPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerEditorSuggest(
			new RedirectEditorSuggester(this, this.settings)
		);

		this.addCommand({
			id: "add-redirect-link",
			name: "Add link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection(this.settings.triggerString);
			},
		});

		this.addCommand({
			id: "redirect-open-filename-modal",
			name: "Insert file path",
			editorCallback: (editor: Editor) => {
				const fileModal = new FilePathModal({
					app: this.app,
					onChooseFile: (file: TFile): void => {
						editor.replaceSelection(`"${file.path}"`);
					},
					limitToNonMarkdown: this.settings.limitToNonMarkdown,
				});
				fileModal.open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new RedirectSettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export class FilePathModal extends FuzzySuggestModal<TFile> {
	files: TFile[];
	onChooseItem: (item: TFile) => void;

	constructor({
		app,
		onChooseFile,
		limitToNonMarkdown,
	}: {
		app: App;
		onChooseFile: (onChooseItem: TFile) => void;
		limitToNonMarkdown: boolean;
	}) {
		super(app);
		this.files = app.vault.getFiles();

		if (limitToNonMarkdown) {
			this.files = this.files.filter(
				(file) => !file.extension.endsWith("md")
			);
		}

		this.onChooseItem = (item: TFile) => {
			onChooseFile(item);
		};
	}
	getItems(): TFile[] {
		return this.files;
	}

	getItemText(item: TFile): string {
		return item.path;
	}
}

const escapeRegExp = (str: string) => {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& = the whole matched string
};

class RedirectEditorSuggester extends EditorSuggest<{
	alias: string;
	path: string;
}> {
	plugin: RedirectPlugin;
	settings: RedirectPluginSettings;
	triggerString: string;

	constructor(plugin: RedirectPlugin, settings: RedirectPluginSettings) {
		super(plugin.app);
		this.plugin = plugin;
		this.settings = settings;
		this.triggerString = this.plugin.settings.triggerString;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const subString = line.substring(0, cursor.ch);
		const match = subString
			.match(new RegExp(escapeRegExp(this.triggerString)))
			?.first();

		const triggerStringClosingBrackets = this.triggerString
			.match(/\[{1,}$/)
			?.first();

		if (match) {
			return {
				start: {
					ch: subString.lastIndexOf(match),
					line: cursor.line,
				},
				end: {
					line: cursor.line,
					ch:
						triggerStringClosingBrackets &&
						editor.getLine(cursor.line).length > cursor.ch &&
						editor.getRange(cursor, {
							line: cursor.line,
							ch: cursor.ch + 1,
						}) === "]".repeat(triggerStringClosingBrackets.length)
							? cursor.ch + 1
							: cursor.ch,
				},
				query: subString.substring(
					subString.lastIndexOf(match) + this.triggerString.length,
					subString.length
				),
			};
		}
	}

	getSuggestions(context: EditorSuggestContext): SuggestionObject[] {
		const files = this.plugin.app.vault.getFiles();
		const redirectsGathered = files
			.map((file) => {
				const frontMatter =
					this.plugin.app.metadataCache.getFileCache(
						file
					)?.frontmatter;
				const aliases =
					frontMatter?.alias || frontMatter?.aliases || [];
				const redirects =
					frontMatter?.redirects || frontMatter?.redirect || [];
				const output = [
					...(Array.isArray(aliases) ? aliases : [aliases]),
					file.name,
				]
					.map((alias: string) => {
						return [
							...(Array.isArray(redirects)
								? redirects
								: [redirects]),
						].map((redirect: string) => {
							return {
								alias: `${alias}`,
								path: `${redirect}`,
								originPath: file.path,
								isAlias: alias === file.name,
							};
						});
					})
					.flat()
					.filter(
						(a) =>
							a.alias.contains(context.query) ||
							a.path.contains(context.query)
					);
				return output;
			})
			.filter((a) => a.length)
			.flat();
		return redirectsGathered;
	}

	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		const suggesterEl = el.createDiv({ cls: "redirect-suggester-el" });
		if (suggestion.isAlias) {
			const aliasEl = suggesterEl.createSpan();
			aliasEl.setText("⤿");
			aliasEl.addClass("redirect-is-alias");
		}
		suggesterEl
			.createDiv({ cls: "redirect-alias" })
			.setText(suggestion.alias);
		suggesterEl
			.createDiv({ cls: "redirect-item" })
			.setText(suggestion.path);
	}

	selectSuggestion(suggestion: SuggestionObject): void {
		if (this.context) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
				suggestion.path,
				suggestion.originPath
			);
			if (file) {
				const markdownLink = this.plugin.app.fileManager
					.generateMarkdownLink(
						file,
						this.plugin.app.workspace.getActiveFile().path,
						"",
						suggestion.alias
					)
					.replace(/^\!/, "");

				const editor: Editor = this.context.editor as Editor;
				editor.replaceRange(
					markdownLink,
					this.context.start,
					this.context.end
				);

				const { ch, line } = this.context.start;
				editor.setCursor({ line, ch: ch + markdownLink.length });
			}
		}
	}
}

class RedirectSettingsTab extends PluginSettingTab {
	plugin: RedirectPlugin;

	constructor(app: App, plugin: RedirectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Redirect" });

		new Setting(containerEl)
			.setName("Limit to non-Markdown files")
			.setDesc("Look for only non-Markdown files.")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.limitToNonMarkdown ||
							DEFAULT_SETTINGS.limitToNonMarkdown
					)
					.onChange(async (value) => {
						this.plugin.settings.limitToNonMarkdown =
							value || DEFAULT_SETTINGS.limitToNonMarkdown;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Trigger string")
			.setDesc(
				"The string to trigger suggestions. Changing this setting requires reloading Obsidian."
			)
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.triggerString ||
							DEFAULT_SETTINGS.triggerString
					)
					.setPlaceholder(DEFAULT_SETTINGS.triggerString)
					.onChange(async (value) => {
						this.plugin.settings.triggerString =
							value || DEFAULT_SETTINGS.triggerString;
						await this.plugin.saveSettings();
					})
			);
	}
}
