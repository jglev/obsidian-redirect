# Obsidian Redirect

An [Obsidian](https://obsidian.md) plugin to facilitate management of especially non-markdown files, by allowing [aliases](https://help.obsidian.md/How+to/Add+aliases+to+note) to be set on any file.

## Motivation

Obsidian is highly featureful for management of markdown notes and metadata describing them. However, it is not currently as featureful for attachments (i.e., non-markdown file) management.

This plugin allows expanding Obsidian's existing metadata management features and tools to apply to other files, including binary files.

This plugin may be particularly useful alongside the [Obsidian Binary File Manager Plugin](https://github.com/qawatake/obsidian-binary-file-manager-plugin), which automatically creates a Markdown file for each binary file in a vault.

## Usage

### YAML front matter

The plugin watches for markdown files that contain a `redirect` or `redirects` element in their [YAML front matter](https://help.obsidian.md/Advanced+topics/YAML+front+matter). Either can be singular or plural. For example:

```md
---
redirect: "path/to/file/in/vault.png"
---

Lorem ipsum...
```

or...

```md
---
redirects: 
  - "path/to/file/in/vault.png"
  - "path/to/second/file/in/vault.png"
---

Lorem ipsum...
```

The plugin will also watch for [`alias` and `aliases` front matter elements](https://help.obsidian.md/How+to/Add+aliases+to+note).

<video src='./img/yaml-examples.mp4' width=180 ></video>

To facilitate the creation of `redirect` / `redirects` YAML front matter entries, the plugin provides a command, `Redirect: Insert redirected file path`, which allows searching files within the vault:

<video src='./img/insert-path-demo.mp4' width=180 ></video>

### Linking to files

While typing in a markdown note, typing `r[` will bring up a searchable suggestion interface, which lists files based on their names, the files that include `redirect` / `redirects` YAML front matter references to them, and those files' aliases. Image files are displayed within the list, facilitating finding the desired image:

<video src='./img/inline-demo.mp4' width=180 ></video>

### Opening files

A similar searchable list is accessible for opening files using the `Redirect: Open redirected file` command:

<video src='./img/open-file-demo.mp4' width=180 ></video>

### Hovering on images

On both desktop and mobile, hovering the mouse / long pressing on an image will expand that image temporarily, allowing one to see it better.

## Installation

### Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-redirect/`.

### From the Community Plugins list

1. Search for "Redirect" in Obsidian's community plugins browser
2. Enable the plugin in your Obsidian settings (find "Redirect" under "Community plugins").
3. Check the "Redirect" settings tab. Add one or more patterns.
4. (Optional) In the "Hotkeys" settings tab, add a hotkey for any of the "Redirect..." commands.

## Development

Clone the repository, run `yarn` to install the dependencies, and run `yarn dev` to compile the plugin and watch file changes.

See https://github.com/obsidianmd/obsidian-api for Obsidian's API documentation.

## License

This plugin's code and documentation is released under the [BSD 3-Clause License](./LICENSE).

# Todo

Automated tests are not currently included in this code for this repository. Assistance in this, particularly using the [Obsidian End-to-End testing approach](https://github.com/trashhalo/obsidian-plugin-e2e-test), is especially welcome!

