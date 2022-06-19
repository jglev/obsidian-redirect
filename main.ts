import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
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
	mySetting: string;
}

const DEFAULT_SETTINGS: RedirectPluginSettings = {
	mySetting: "default",
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
				console.log(editor.getSelection());
				editor.replaceSelection("r[");
			},
		});

		this.addCommand({
			id: "redirect-open-filename-modal",
			name: "Insert file path",
			callback: () => {
				new FilePathModal(this.app).open();
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

class FilePathModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RedirectSettingsTab extends PluginSettingTab {
	plugin: RedirectPlugin;

	constructor(app: App, plugin: RedirectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for my awesome plugin." });

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						console.log("Secret: " + value);
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
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
		this.triggerString = "r[";
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const subString = line.substring(0, cursor.ch);
		console.log(134, subString);
		const match = subString
			.match(new RegExp(escapeRegExp(this.triggerString)))
			?.first();

		console.log(120, match);

		if (match) {
			return {
				start: {
					ch: subString.lastIndexOf(match),
					line: cursor.line,
				},
				end: {
					line: cursor.line,
					ch:
						editor.getLine(cursor.line).length > cursor.ch &&
						editor.getRange(cursor, {
							line: cursor.line,
							ch: cursor.ch + 1,
						}) === "]"
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
		console.log(136, context);
		const files = this.plugin.app.vault.getFiles();
		console.log(141, files);
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
								alias,
								path: redirect,
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
		console.log(151, redirectsGathered);
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
		console.log(220, suggestion);
		if (this.context) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
				suggestion.path,
				suggestion.originPath
			);
			console.log(225, file);
			if (file) {
				const markdownLink = this.plugin.app.fileManager
					.generateMarkdownLink(
						file,
						this.plugin.app.workspace.getActiveFile().path,
						"",
						suggestion.alias
					)
					.replace(/^\!/, "");

				console.log(225, markdownLink);

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
