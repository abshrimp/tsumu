# Install the Tsumu AI Skill

[README](../README.md) · [日本語](skills.ja.md)

The **tsumu** Agent Skill teaches compatible AI apps to create full, editable websites for [Tsumu](https://tsumu.ebii.net), rather than a screenshot or HTML-only mockup. You do **not** need Node.js, Git, or a local build to install it.

**[Download the ready-to-use Tsumu Skill ZIP](https://github.com/abshrimp/tsumu/raw/refs/heads/main/dist/tsumu-skill.zip)**

The ZIP contains one top-level `tsumu/` folder with `SKILL.md` and **all bundled references**. It is included directly in the repository and verified against the source by CI. [Browse the Skill source](../skills/tsumu/SKILL.md).

## Choose your AI app

### ChatGPT (eligible workspaces)

1. Download `tsumu-skill.zip` above.
2. Open [chatgpt.com/skills](https://chatgpt.com/skills), select **Add → Upload from your computer**, then select the ZIP.
3. After installation, ask: **"Use the tsumu skill to create a modern portfolio site."**

Skill upload is available only for **eligible ChatGPT Business, Enterprise, Healthcare and Edu accounts**, subject to workspace settings. If Skills is not shown, your account or workspace may not support it. For details, see the [official ChatGPT Skills guide](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).

### Claude (web or desktop chat)

1. Download the ZIP.
2. Open [claude.ai/plugins/new/upload](https://claude.ai/plugins/new/upload) and upload the ZIP.
3. Enable the `tsumu` Skill and ask Claude to create a new Tsumu website.

Upload the entire ZIP, not only `SKILL.md`, because the required references are included in the ZIP. For details, see the [official Claude guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude).

### Claude Code

To use the Skill in all projects, extract the downloaded ZIP into `~/.claude/skills` as shown below. For a single project, use `.claude/skills` instead.

```sh
mkdir -p ~/.claude/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.claude/skills
```

Restart the session if needed, then ask Claude Code to use the `tsumu` Skill.

### Cursor

For all local projects, extract the ZIP into `~/.cursor/skills`; for one project, use `.cursor/skills`:

```sh
mkdir -p ~/.cursor/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.cursor/skills
```

Cursor discovers `tsumu/SKILL.md` with its references. For details, see the [official Cursor Skills documentation](https://cursor.com/docs/skills).

### Codex (CLI, IDE, or app)

Extract into `~/.agents/skills` for your user, or `.agents/skills` for the current project:

```sh
mkdir -p ~/.agents/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.agents/skills
```

Open a new Codex session to discover the Skill. For details, see the [official Codex Skills guide](https://learn.chatgpt.com/docs/build-skills).

### Gemini CLI

For user-level Skills, extract the ZIP into `~/.gemini/skills`. Gemini CLI also recognizes `~/.agents/skills`.

```sh
mkdir -p ~/.gemini/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.gemini/skills
```

Run `/skills list` or `gemini skills list` and confirm that `tsumu` is visible. For details, see the [official Gemini CLI Skills guide](https://geminicli.com/docs/cli/skills/).

### Google Antigravity

For global usage, extract to `~/.gemini/config/skills`. For the current project, use `.agents/skills`:

```sh
mkdir -p ~/.gemini/config/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.gemini/config/skills
```

Start a new agent session and ask it to use the `tsumu` Skill. For details, see the [official Antigravity Skills guide](https://codelabs.developers.google.com/getting-started-agy-ide).

## MCP connection vs. Skill

Installing the Skill **does not automatically connect** Tsumu's MCP server.

- **With an authorized Tsumu MCP connection:** the agent can call `get_site_doc_spec` and `stage_site_doc`, then provide the **exact one-time private import URL**. This imports a new editable site; it does not publish it.
- **Without MCP:** the Skill can generate a `doc.json` file you can import from the [Tsumu homepage](https://tsumu.ebii.net). The Skill includes an offline SiteDoc starter when reference files are inaccessible.

For supported clients, connect the MCP endpoint `https://mcp.tsumu.ebii.net/mcp` and authorize **new-site creation only** to create a new site without pairing an existing editor. See the [Tsumu MCP connection guide](https://mcp.tsumu.ebii.net/). App support for MCP varies.

## Verification and troubleshooting

Ask: **"Use the tsumu Skill to create a polished landing page."** A working result is a real import link (MCP) or importable `doc.json` (offline), not only a design explanation. If your AI says it cannot find `references/site-doc.md`, reinstall the **entire ZIP** rather than pasting `SKILL.md` alone. If it says MCP is not connected, file generation should still work.

The ZIP is **prebuilt** in [`dist/tsumu-skill.zip`](../dist/tsumu-skill.zip). Maintainers only: regenerate it after changing the Skill with `npm run skill:package`. CI checks that the checked-in file matches the generated package.
