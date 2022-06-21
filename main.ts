import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	FileSystemAdapter,
	FuzzyMatch,
	FuzzySuggestModal,
	Keymap,
	KeymapEventHandler,
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
	originTFile: TFile;
	isAlias: boolean;
	embedPath: string;
	extension: string;
	redirectTFile: TFile;
};

interface RedirectPluginSettings {
	limitToNonMarkdown: boolean;
	triggerString: string;
	mode: Mode;
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

enum Mode {
	RedirectOpen = "Redirect Files",
	Standard = "Standard",
}

const DEFAULT_SETTINGS: RedirectPluginSettings = {
	limitToNonMarkdown: true,
	triggerString: "r[",
	mode: Mode.Standard,
};

const getRedirectFiles = (
	plugin: RedirectPlugin,
	files: TFile[],
	filterString?: string
) => {
	let redirectsGathered = files
		.map((file) => {
			const frontMatter =
				plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			const aliases = frontMatter?.alias || frontMatter?.aliases || [];
			const redirects =
				frontMatter?.redirects || frontMatter?.redirect || [];
			const output = [
				...(Array.isArray(aliases) ? aliases : [aliases]),
				file.name,
			]
				.map((alias: string) => {
					return [
						...(Array.isArray(redirects) ? redirects : [redirects]),
					].map((redirect: string) => {
						const redirectTFile =
							plugin.app.metadataCache.getFirstLinkpathDest(
								redirect,
								file.path
							);

						if (redirectTFile === null) {
							return;
						}

						const embedPath =
							plugin.app.vault.getResourcePath(redirectTFile);
						return {
							alias: `${alias}`,
							path: `${redirect}`,
							originTFile: file,
							embedPath: embedPath,
							isAlias: alias !== file.name,
							extension: redirect.split(".").pop(),
							redirectTFile: redirectTFile,
						};
					});
				})
				.flat()
				.filter((a) => {
					if (a === undefined) {
						return false;
					}

					if (!filterString) {
						return true;
					}

					const queryWords = filterString
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
	if (plugin.settings.limitToNonMarkdown) {
		redirectsGathered = redirectsGathered.filter(
			(redirect) => !(redirect.extension === "md")
		);
	}
	return redirectsGathered;
};

const renderSuggestionObject = (
	suggestion: SuggestionObject,
	el: HTMLElement
): void => {
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
		const imgContainerEl = suggesterEl.createDiv({
			cls: "redirect-suggestion-image-container",
		});
		const imgContainerSmallEl = imgContainerEl.createDiv({
			cls: "redirect-suggestion-image-container-small",
		});
		// const imgEl = imgContainerSmallEl.createEl("img");
		// imgEl.addClass("redirect-suggestion-image-small");
		// imgEl.setAttr("src", suggestion.embedPath);
		// imgEl.setAttr("alt", "");
		imgContainerSmallEl.style.backgroundImage = `url('${suggestion.embedPath}')`;

		const imgLargeEl = imgContainerEl.createEl("img");
		imgLargeEl.addClass("redirect-suggestion-image-large");
		imgLargeEl.setAttr("src", suggestion.embedPath);
		imgLargeEl.setAttr("alt", "");
	}
};

interface FileWithPath extends File {
	path: string;
}

export default class RedirectPlugin extends Plugin {
	settings: RedirectPluginSettings;
	statusBar: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.registerEditorSuggest(
			new RedirectEditorSuggester(this, this.settings)
		);

		this.app.workspace.on(
			// @ts-ignore
			"editor-drop",
			async (evt: ClipboardEvent, editor: Editor) => {
				// Per https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3690,
				// "Check for `evt.defaultPrevented` before attempting to handle this
				// event, and return if it has been already handled."
				if (evt.defaultPrevented) {
					return;
				}

				// From https://discord.com/channels/686053708261228577/840286264964022302/851183938542108692:
				if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
					// Not on desktop, thus there is no basePath available.
					console.log(
						"Unable to process dropped files when not on desktop"
					);
					return;
				}
				evt.preventDefault();

				// @ts-ignore
				let basePath = app.vault.adapter.getBasePath();
				console.log(185, basePath);

				// @ts-ignore
				const files = evt.dataTransfer.files;
				console.log(212, typeof files[0]);

				const redirectFiles = getRedirectFiles(
					this,
					app.vault.getFiles()
				);
				console.log(224, redirectFiles);

				[...files].forEach((f: FileWithPath) => {
					const fileIsInVault = f.path.startsWith(basePath);
					console.log(215, f, fileIsInVault);
					if (fileIsInVault) {
						const filePathWithinVault = f.path
							.replace(basePath, "")
							.replace(/^[\/\\]/, "");
						console.log(235, filePathWithinVault, basePath);
						const relevantRedirectFiles = redirectFiles.filter(
							(f) => f.redirectTFile.path === filePathWithinVault
						);
						console.log(236, relevantRedirectFiles);

						const relevantRedirectFilesChunked = [
							...new Set(
								relevantRedirectFiles.map(
									(f) => f.originTFile.path
								)
							),
						];

						if (
							[...files].length === 1 &&
							relevantRedirectFilesChunked.length === 1
						) {
							this.app.workspace
								.getLeaf(false)
								.openFile(relevantRedirectFiles[0].originTFile);
							return;
						}

						if (relevantRedirectFilesChunked.length > 1) {
							const fileModal = new FilePathModal({
								app: this.app,
								plugin: this,
								fileOpener: true,
								onChooseFile: (
									file: SuggestionObject,
									newPane: boolean
								): void => {
									this.app.workspace
										.getLeaf(newPane)
										.openFile(file.originTFile);
								},
								limitToNonMarkdown:
									this.settings.limitToNonMarkdown,
								files: relevantRedirectFiles,
							});
							fileModal.open();
						}
					}
				});
			}
		);

		this.addCommand({
			id: "add-redirect-link",
			name: "Trigger redirected link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection(this.settings.triggerString);
			},
		});

		this.addCommand({
			id: "change-mode",
			name: "Change mode",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				this.settings.mode =
					this.settings.mode === Mode.Standard
						? Mode.RedirectOpen
						: Mode.Standard;
				this.statusBar.setText(`${this.settings.mode}`);
				await this.saveSettings();
			},
		});

		this.addCommand({
			id: "redirect-insert-file-path",
			name: "Insert redirected file path",
			editorCallback: (editor: Editor) => {
				const fileModal = new FilePathModal({
					app: this.app,
					plugin: this,
					fileOpener: false,
					onChooseFile: (file: SuggestionObject): void => {
						this.app.keymap;
						editor.replaceSelection(`"${file.path}"`);
					},
					limitToNonMarkdown: this.settings.limitToNonMarkdown,
					files: app.vault.getFiles().map((file) => {
						return {
							alias: `${file.name}`,
							path: `${file.path}`,
							originTFile: file,
							embedPath: this.app.vault.getResourcePath(file),
							isAlias: false,
							extension: file.extension,
							redirectTFile: file,
						};
					}),
				});
				fileModal.open();
			},
		});

		this.addCommand({
			id: "redirect-open-file",
			name: "Open redirected file",
			callback: () => {
				const fileModal = new FilePathModal({
					app: this.app,
					plugin: this,
					fileOpener: true,
					onChooseFile: (
						file: SuggestionObject,
						newPane: boolean
					): void => {
						this.app.workspace
							.getLeaf(newPane)
							.openFile(file.redirectTFile);
					},
					limitToNonMarkdown: this.settings.limitToNonMarkdown,
					files: getRedirectFiles(this, app.vault.getFiles()),
				});
				fileModal.open();
			},
		});

		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText(`${this.settings.mode}`);

		this.statusBar.onClickEvent(async () => {
			this.settings.mode =
				this.settings.mode === Mode.Standard
					? Mode.RedirectOpen
					: Mode.Standard;
			this.statusBar.setText(`${this.settings.mode}`);
			await this.saveSettings();
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

export class FilePathModal extends FuzzySuggestModal<SuggestionObject> {
	files: SuggestionObject[];
	onChooseItem: (item: SuggestionObject) => void;
	ctrlKeyHandler: KeymapEventHandler;

	constructor({
		app,
		plugin,
		fileOpener,
		onChooseFile,
		limitToNonMarkdown,
		files,
	}: {
		app: App;
		plugin: RedirectPlugin;
		fileOpener: boolean;
		onChooseFile: (
			onChooseItem: SuggestionObject,
			ctrlKey: boolean
		) => void;
		limitToNonMarkdown: boolean;
		files: SuggestionObject[];
	}) {
		super(app);
		this.files = files;

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
			this.ctrlKeyHandler = this.scope.register(
				["Ctrl"],
				"Enter",
				(evt: KeyboardEvent) => {
					// @ts-ignore
					this.chooser.useSelectedItem(evt);
					return false;
				}
			);

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

		this.onChooseSuggestion = (item: FuzzyMatch<SuggestionObject>, evt) => {
			this.scope.unregister(this.ctrlKeyHandler);
			onChooseFile(item.item, evt.ctrlKey);
		};
	}

	getItems(): SuggestionObject[] {
		return this.files;
	}

	renderSuggestion(
		item: FuzzyMatch<SuggestionObject>,
		el: HTMLElement
	): void {
		renderSuggestionObject(item.item, el);
	}

	getItemText(item: SuggestionObject): string {
		return `${item.path} ${item.alias} ${item.originTFile.path}`;
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
		return getRedirectFiles(
			this.plugin,
			this.plugin.app.vault.getFiles(),
			context.query
		);
	}

	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		renderSuggestionObject(suggestion, el);
	}

	selectSuggestion(suggestion: SuggestionObject): void {
		if (this.context) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
				suggestion.path,
				suggestion.originTFile.path
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
				'The string to trigger suggestions. Changing this setting requires reloading Obsidian. Triggering may not work if this string conflicts with an existing trigger (e.g., "[[").'
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
