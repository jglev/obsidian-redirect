import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	FuzzyMatch,
	FuzzySuggestModal,
	Keymap,
	KeymapInfo,
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
	embedPath: string;
	extension: string;
};

interface RedirectPluginSettings {
	limitToNonMarkdown: boolean;
	triggerString: string;
}

// From https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types:
const imageExtensions = [
	"jpg",
	"jpeg",
	"jfif",
	"pjpeg",
	"pjp",
	"png",
	"svg",
	"webp",
	"apng",
	"avif",
	"gif",
	"bmp",
	"ico",
	"cur",
	"tif",
	"tiff",
];

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
			id: "redirect-insert-file-path",
			name: "Insert file path",
			editorCallback: (editor: Editor) => {
				const fileModal = new FilePathModal({
					app: this.app,
					fileOpener: false,
					onChooseFile: (file: TFile): void => {
						this.app.keymap;
						editor.replaceSelection(`"${file.path}"`);
					},
					limitToNonMarkdown: this.settings.limitToNonMarkdown,
				});
				fileModal.open();
			},
		});

		this.addCommand({
			id: "redirect-open-file",
			name: "Open file",
			callback: () => {
				const fileModal = new FilePathModal({
					app: this.app,
					fileOpener: true,
					onChooseFile: (file: TFile, newPane: boolean): void => {
						console.log(104, this.app.keymap);
						this.app.workspace.getLeaf(newPane).openFile(file);
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
		fileOpener,
		onChooseFile,
		limitToNonMarkdown,
	}: {
		app: App;
		fileOpener: boolean;
		onChooseFile: (onChooseItem: TFile, ctrlKey: boolean) => void;
		limitToNonMarkdown: boolean;
	}) {
		super(app);
		this.files = app.vault.getFiles();

		const instructions = [
			{ command: "⮁", purpose: "to navigate" },
			{
				command: "⤶",
				purpose: "to open",
			},
			{
				command: "esc",
				purpose: "to dismiss",
			},
		];

		if (fileOpener) {
			// Allow using Ctrl + Enter, following the example at
			// https://github.com/kometenstaub/obsidian-linked-data-vocabularies/blob/2eb4a8b206a2d8b455dc556f3d797c92c440c258/src/ui/LOC/suggester.ts#L41
			// (linked from https://discord.com/channels/686053708261228577/840286264964022302/988079192816107560)
			this.scope.register(["Ctrl"], "Enter", (evt: KeyboardEvent) => {
				// @ts-ignore
				this.chooser.useSelectedItem(evt);
				return false;
			});

			instructions.splice(2, 0, {
				command: "ctrl ⤶",
				purpose: "to open in new pane",
			});
		}

		this.setInstructions(instructions);

		if (limitToNonMarkdown) {
			this.files = this.files.filter(
				(file) => !file.extension.endsWith("md")
			);
		}

		this.onChooseSuggestion = (item: FuzzyMatch<TFile>, evt) => {
			onChooseFile(item.item, evt.ctrlKey);
		};
	}
	getItems(): TFile[] {
		return this.files;
	}

	renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
		const suggesterEl = el.createDiv({ cls: "redirect-suggester-el" });
		const suggestionTextEl = suggesterEl.createDiv({
			cls: "redirect-suggestion-text",
		});
		suggestionTextEl
			.createDiv({ cls: "redirect-alias" })
			.setText(item.item.name);
		suggestionTextEl
			.createDiv({ cls: "redirect-item" })
			.setText(item.item.path);
		if (imageExtensions.contains(item.item.extension)) {
			const imgEl = suggesterEl.createEl("img");
			imgEl.addClass("redirect-suggestion-image");
			imgEl.setAttr("src", this.app.vault.getResourcePath(item.item));
			imgEl.setAttr("alt", "");
		}
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
		let files = this.plugin.app.vault.getFiles();

		let redirectsGathered = files
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
							const embedPath =
								this.plugin.app.vault.getResourcePath(
									this.plugin.app.metadataCache.getFirstLinkpathDest(
										redirect,
										file.path
									)
								);
							return {
								alias: `${alias}`,
								path: `${redirect}`,
								originPath: file.path,
								embedPath: embedPath,
								isAlias: alias !== file.name,
								extension: redirect.split(".").pop(),
							};
						});
					})
					.flat()
					.filter((a) => {
						if (context.query === "") {
							return a;
						}

						const queryWords = context.query
							.toLowerCase()
							.split(/\s{1,}/);
						return queryWords.every((word) => {
							return (
								a.alias.toLowerCase().contains(word) ||
								a.path.toLowerCase().contains(word)
							);
						});
					});

				return output;
			})
			.filter((a) => a.length)
			.flat();
		if (this.settings.limitToNonMarkdown) {
			redirectsGathered = redirectsGathered.filter(
				(redirect) => !redirect.path.endsWith("md")
			);
		}
		return redirectsGathered;
	}

	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		const suggesterEl = el.createDiv({ cls: "redirect-suggester-el" });
		if (suggestion.isAlias) {
			const aliasEl = suggesterEl.createSpan();
			aliasEl.setText("⤿");
			aliasEl.addClass("redirect-is-alias");
		}
		const suggestionTextEl = suggesterEl.createDiv({
			cls: "redirect-suggestion-text",
		});
		suggestionTextEl
			.createDiv({ cls: "redirect-alias" })
			.setText(suggestion.alias);
		suggestionTextEl
			.createDiv({ cls: "redirect-item" })
			.setText(suggestion.path);
		if (imageExtensions.contains(suggestion.extension)) {
			const imgEl = suggesterEl.createEl("img");
			imgEl.addClass("redirect-suggestion-image");
			imgEl.setAttr("src", suggestion.embedPath);
			imgEl.setAttr("alt", "");
		}
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
					.setValue(this.plugin.settings.limitToNonMarkdown)
					.onChange(async (value) => {
						this.plugin.settings.limitToNonMarkdown = value;
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
