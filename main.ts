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

		this.registerEvent(
			this.app.vault.on("create", async (file: TAbstractFile) => {
				console.log("create", file);
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", async (file: TAbstractFile) => {
				console.log("delete", file);
			})
		);

		this.registerEvent(
			this.app.vault.on(
				"rename",
				async (file: TAbstractFile, oldPath: string) => {
					console.log("rename", file, oldPath);
				}
			)
		);

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

class RedirectEditorSuggester extends EditorSuggest<{
	alias: string;
	path: string;
}> {
	plugin: RedirectPlugin;
	settings: RedirectPluginSettings;

	constructor(plugin: RedirectPlugin, settings: RedirectPluginSettings) {
		super(plugin.app);
		this.plugin = plugin;
		this.settings = settings;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		console.log(120, cursor, editor);
		const sub = editor.getLine(cursor.line).substring(0, cursor.ch);
		const match = sub.match(/!r\[/)?.first();
		if (match) {
			console.log(
				126,
				editor.getLine(cursor.line).length > cursor.ch &&
					editor.getRange(cursor, {
						line: cursor.line,
						ch: cursor.ch + 1,
					}) === "]"
			);
			return {
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
				start: {
					ch: sub.lastIndexOf(match),
					line: cursor.line,
				},
				query: match,
			};
		}
	}

	getSuggestions(context: EditorSuggestContext): {
		alias: string;
		path: string;
	}[] {
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
							return { alias, path: redirect };
						});
					})
					.flat();
				return output;
			})
			.filter((a) => a.length)
			.flat();
		console.log(151, redirectsGathered);
		return redirectsGathered;
	}

	renderSuggestion(
		suggestion: { alias: string; path: string },
		el: HTMLElement
	): void {
		const suggesterEl = el.createDiv({ cls: "redirect-suggester-el" });
		suggesterEl
			.createDiv({ cls: "redirect-shortcode" })
			.setText(suggestion.alias);
		suggesterEl
			.createDiv({ cls: "redirect-item" })
			.setText(suggestion.path);
	}

	selectSuggestion(suggestion: { alias: string; path: string }): void {
		if (this.context) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
				suggestion.path,
				""
			);
			if (file) {
				const markdownLink =
					this.plugin.app.fileManager.generateMarkdownLink(
						file,
						this.plugin.app.workspace.getActiveFile().path,
						"",
						suggestion.alias
					);

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
