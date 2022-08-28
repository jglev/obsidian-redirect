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
	KeymapEventHandler,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import * as yaml from "js-yaml";
import yamlFront from "front-matter";

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
	apiVersion: number;
	limitToRedirectedFiles: boolean;
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
	RedirectOpen = "Open",
	Standard = "Standard",
}

const DEFAULT_SETTINGS: RedirectPluginSettings = {
	limitToNonMarkdown: true,
	triggerString: "r[",
	mode: Mode.Standard,
	limitToRedirectedFiles: true,
	apiVersion: 2,
};

export class AliasPromptModal extends Modal {
	newAlias: string;
	file: TFile;
	enterKeyHandler: KeymapEventHandler;

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
		this.enterKeyHandler = this.scope.register(
			[],
			"Enter",
			(evt: KeyboardEvent) => {
				this.submitAlias();
				return false;
			}
		);
	}

	async submitAlias() {
		const fileParsed = yamlFront(
			await app.vault.adapter.read(this.file.path)
		);
		const attributes: Record<string, any> = fileParsed.attributes;

		const frontMatterAliases = [
			...(attributes?.alias ? [attributes.alias] : []),
			...(attributes?.aliases
				? Array.isArray(attributes.aliases)
					? attributes.aliases
					: [attributes.aliases]
				: []),
			this.newAlias,
		];

		const newFrontMatter: Record<string, any> = fileParsed.attributes;

		if (Object.keys(newFrontMatter).includes("alias")) {
			delete newFrontMatter.alias;
		}
		if (Object.keys(newFrontMatter).includes("aliases")) {
			delete newFrontMatter.aliases;
		}

		const newContent = `---\n${yaml.dump({
			...newFrontMatter,
			aliases: frontMatterAliases,
		})}---\n\n${fileParsed.body}`;

		app.vault.adapter.write(this.file.path, newContent);

		this.scope.unregister(this.enterKeyHandler);
		this.close();
	}

	onOpen() {
		const { contentEl } = this;

		// contentEl.createEl("h1", { text: "New alias" });

		new Setting(contentEl).setName("New alias").addText((text) =>
			text.onChange((value) => {
				this.newAlias = value;
			})
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(async () => {
					this.submitAlias();
				})
		);
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

const getRedirectFiles = (
	plugin: RedirectPlugin,
	files: TFile[],
	limitToRedirectedFiles: boolean,
	filterString?: string
) => {
	let redirectsGathered = files
		.map((file) => {
			const frontMatter =
				plugin.app.metadataCache.getFileCache(file)?.frontmatter;

			let aliases = frontMatter?.alias || frontMatter?.aliases || [];

			if (!Array.isArray(aliases)) {
				aliases = aliases != null ? [aliases] : [];
			}

			aliases = aliases.filter(
				(a: String) => a !== null && a !== undefined
			);
			let redirects =
				frontMatter?.redirects ||
				frontMatter?.redirect ||
				(limitToRedirectedFiles ? [] : [file.path]);

			if (!Array.isArray(redirects)) {
				redirects = redirects != null ? [redirects] : [];
			}

			redirects = redirects.filter(
				(r: String) => r !== null && r !== undefined
			);

			let output = [
				...(Array.isArray(aliases) ? aliases : [aliases]),
				file.basename,
			]
				.map((alias: string) => {
					if (alias === "" || alias === undefined) {
						return null;
					}
					return [
						...(Array.isArray(redirects) ? redirects : [redirects]),
					]
						.filter((o) => o !== null && o !== undefined)
						.map((redirect: string) => {
							const redirectTFile =
								plugin.app.metadataCache.getFirstLinkpathDest(
									redirect,
									file.path
								);

							if (
								redirectTFile === null ||
								redirectTFile === undefined
							) {
								return;
							}

							const embedPath =
								plugin.app.vault.getResourcePath(redirectTFile);
							return {
								alias: `${alias}`,
								path: `${redirect}`,
								originTFile: file,
								embedPath: embedPath,
								isAlias: alias !== file.basename,
								extension: redirect.split(".").pop(),
								redirectTFile: redirectTFile,
							};
						});
				})
				.flat();

			output = output.filter((a) => {
				if (a === undefined || a === null) {
					return false;
				}
				if (a.originTFile === a.redirectTFile) {
					return false;
				}

				if (a === undefined) {
					return false;
				}

				if (!filterString) {
					return true;
				}

				const queryWords = filterString.toLowerCase().split(/\s{1,}/);

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
		.flat()
		.filter((r) => r !== undefined && r !== null);

	if (plugin.settings.limitToNonMarkdown) {
		redirectsGathered = redirectsGathered.filter(
			(redirect) => redirect?.extension && !(redirect.extension === "md")
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

enum HandleFilesWithModalAction {
	OpenFile,
	AddAliasToFile,
}

const handleFilesWithModal = (
	plugin: RedirectPlugin,
	app: App,
	files: FileWithPath[] | TFile[],
	ctrlKey: boolean,
	action: HandleFilesWithModalAction
) => {
	const redirectFiles = getRedirectFiles(
		plugin,
		app.vault.getFiles(),
		plugin.settings.limitToRedirectedFiles
	);

	[...files].forEach((f: FileWithPath | TFile) => {
		let filePath = f.path;

		if (f instanceof File) {
			// @ts-ignore
			const basePath = app.vault.adapter.getBasePath();

			// The last replace below is to normalize Windows paths to posix-like
			// ones, since even on Windows, TFile paths seem to use forward slashes.
			filePath = f.path
				.replace(basePath, "")
				.replace(/^[\/\\]/, "")
				.replace("\\", "/");
		}

		const relevantRedirectFiles = redirectFiles.filter((redirectFile) => {
			return redirectFile.redirectTFile.path === filePath;
		});

		const relevantRedirectFilesChunked = [
			...new Set(relevantRedirectFiles.map((f) => f.originTFile.path)),
		];

		if (
			[...files].length === 1 &&
			relevantRedirectFilesChunked.length === 1
		) {
			if (action === HandleFilesWithModalAction.OpenFile) {
				plugin.app.workspace
					.getLeaf(ctrlKey)
					.openFile(relevantRedirectFiles[0].originTFile);
				return;
			}

			if (action === HandleFilesWithModalAction.AddAliasToFile) {
				const newAliasModal = new AliasPromptModal(
					plugin.app,
					relevantRedirectFiles[0].originTFile
				);
				newAliasModal.open();
				return;
			}
		}

		if (relevantRedirectFilesChunked.length >= 1) {
			const fileModal = new FilePathModal({
				app: plugin.app,
				fileOpener: true,
				onChooseFile: (
					file: SuggestionObject,
					newPane: boolean
				): void => {
					if (action === HandleFilesWithModalAction.OpenFile) {
						plugin.app.workspace
							.getLeaf(newPane)
							.openFile(file.originTFile);
						return;
					}

					if (action === HandleFilesWithModalAction.AddAliasToFile) {
						const newAliasModal = new AliasPromptModal(
							plugin.app,
							file.originTFile
						);
						newAliasModal.open();
						return;
					}
				},
				limitToNonMarkdown: plugin.settings.limitToNonMarkdown,
				files: relevantRedirectFiles,
			});
			fileModal.open();
		}
	});
};

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
			async (evt: DragEvent, editor: Editor) => {
				// Per https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3690,
				// "Check for `evt.defaultPrevented` before attempting to handle this
				// event, and return if it has been already handled."
				if (evt.defaultPrevented) {
					return;
				}

				if (this.settings.mode !== Mode.RedirectOpen) {
					return;
				}

				// From https://discord.com/channels/686053708261228577/840286264964022302/851183938542108692:
				if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
					// Not on desktop, thus there is no basePath available.
					return;
				}
				evt.preventDefault();

				const basePath = this.app.vault.adapter.getBasePath();

				// @ts-ignore
				const files = [...evt.dataTransfer.files].filter(
					(f: FileWithPath) => f.path.startsWith(basePath)
				);

				handleFilesWithModal(
					this,
					app,
					files,
					evt.ctrlKey,
					HandleFilesWithModalAction.OpenFile
				);
			}
		);

		this.addCommand({
			id: "add-redirect-link",
			icon: "link",
			name: "Trigger redirected link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection(this.settings.triggerString);
			},
		});

		this.addCommand({
			id: "redirect-insert-file-path",
			icon: "pin",
			name: "Insert redirected file path",
			editorCallback: (editor: Editor) => {
				const fileModal = new FilePathModal({
					app: this.app,
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
			icon: "go-to-file",
			name: "Open file",
			callback: () => {
				const fileModal = new FilePathModal({
					app: this.app,
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
					files: getRedirectFiles(
						this,
						app.vault.getFiles(),
						this.settings.limitToRedirectedFiles
					),
				});
				fileModal.open();
			},
		});

		this.addCommand({
			id: "redirect-open-origin-file",
			icon: "go-to-file",
			name: "Open origin file",
			callback: () => {
				const fileModal = new FilePathModal({
					app: this.app,
					fileOpener: true,
					onChooseFile: (
						file: SuggestionObject,
						newPane: boolean
					): void => {
						this.app.workspace
							.getLeaf(newPane)
							.openFile(file.originTFile);
					},
					limitToNonMarkdown: this.settings.limitToNonMarkdown,
					files: getRedirectFiles(
						this,
						app.vault.getFiles(),
						this.settings.limitToRedirectedFiles
					),
				});
				fileModal.open();
			},
		});

		this.addCommand({
			id: "redirect-open-current-file-origin",
			icon: "popup-open",
			name: "Open current file's origin file",
			checkCallback: (checking: boolean) => {
				const currentFile = this.app.workspace.getActiveFile();
				let redirectFiles = getRedirectFiles(
					this,
					app.vault.getFiles(),
					true
				).filter(
					(a: SuggestionObject) => a.redirectTFile === currentFile
				);
				if (checking) {
					if (!redirectFiles.length) {
						return false;
					}
					return true;
				}

				const redirectFilesSet = [
					...new Set(
						redirectFiles.map(
							(a: SuggestionObject) => a.originTFile
						)
					),
				];

				// If all redirect files are the same (even with
				// different aliases), collapse them to one:
				if (redirectFilesSet.length === 1) {
					this.app.workspace
						.getLeaf(false)
						.openFile(redirectFiles[0].originTFile);

					return;
				}

				if (redirectFilesSet.length > 1) {
					const fileModal = new FilePathModal({
						app: this.app,
						fileOpener: true,
						onChooseFile: (
							file: SuggestionObject,
							newPane: boolean
						): void => {
							this.app.workspace
								.getLeaf(newPane)
								.openFile(file.originTFile);
						},
						limitToNonMarkdown: this.settings.limitToNonMarkdown,
						files: redirectFiles,
					});
					fileModal.open();

					return;
				}
			},
		});

		// Add to the right-click file menu. For another example
		// of this, see https://github.com/Oliver-Akins/file-hider/blob/main/src/main.ts#L24-L64
		this.registerEvent(
			this.app.workspace.on(`file-menu`, (menu, file) => {
				if (
					file instanceof TFile &&
					(!this.settings.limitToNonMarkdown ||
						(this.settings.limitToNonMarkdown &&
							file.extension !== "md"))
				) {
					menu.addItem((item) => {
						item.setTitle("Open redirect origin file")
							.setIcon("right-arrow-with-tail")
							.onClick((e: MouseEvent) => {
								handleFilesWithModal(
									this,
									app,
									[file],
									e.ctrlKey,
									HandleFilesWithModalAction.OpenFile
								);
							});
					});

					menu.addItem((item) => {
						item.setTitle("Add alias to redirect origin file")
							.setIcon("plus-with-circle")
							.onClick((e: MouseEvent) => {
								handleFilesWithModal(
									this,
									app,
									[file],
									e.ctrlKey,
									HandleFilesWithModalAction.AddAliasToFile
								);
							});
					});
				}
			})
		);

		// From https://discord.com/channels/686053708261228577/840286264964022302/851183938542108692:
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			// On desktop.
			this.statusBar = this.addStatusBarItem();
			this.statusBar.setText(`Redirect drop: ${this.settings.mode}`);

			this.statusBar.onClickEvent(async () => {
				this.settings.mode =
					this.settings.mode === Mode.Standard
						? Mode.RedirectOpen
						: Mode.Standard;
				this.statusBar.setText(`Redirect drop: ${this.settings.mode}`);
				await this.saveSettings();
			});

			this.addCommand({
				id: "change-mode",
				icon: "switch",
				name: "Change mode",
				editorCallback: async (editor: Editor, view: MarkdownView) => {
					this.settings.mode =
						this.settings.mode === Mode.Standard
							? Mode.RedirectOpen
							: Mode.Standard;
					this.statusBar.setText(
						`Redirect drop: ${this.settings.mode}`
					);
					await this.saveSettings();
				},
			});
		}

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
		fileOpener,
		onChooseFile,
		limitToNonMarkdown,
		files,
	}: {
		app: App;
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
			this.plugin.settings.limitToRedirectedFiles,
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
			.setName("Limit to redirected files")
			.setDesc(
				`Look for only files that are redirected. If this is off, all files in the Vault will be listed (subject to the "Limit to non-Markdown files" setting above), supplemented with a list of redirected files.`
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.limitToRedirectedFiles)
					.onChange(async (value) => {
						this.plugin.settings.limitToRedirectedFiles = value;
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
