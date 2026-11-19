# Tsumu AI Skill の導入方法

[README](../README.ja.md) · [English](skills.md)

**tsumu** は、AIにTsumuで編集できるWebサイトを作らせるためのAgent Skillです。画像やHTMLのモックアップではなく、Tsumuでインポートできるデータを生成します。導入のためにNode.jsやGitを用意する必要はありません。

**[Tsumu Skill ZIPをダウンロード](https://github.com/abshrimp/tsumu/raw/refs/heads/main/dist/tsumu-skill.zip)**

ZIPの直下に `tsumu/` があり、`SKILL.md` と**参照ファイル一式**が含まれています。ZIPはリポジトリに事前収録され、CIで内容を検証します。[Skillのソース](../skills/tsumu/SKILL.md)も確認できます。

## AIアプリ別の導入手順

### ChatGPT（対応ワークスペース）

1. 上のZIPをダウンロードします。
2. ChatGPTの **プラグイン → Skills → 作成 → コンピューターからアップロード** でZIPを選びます。
3. 「tsumu Skillを使って、モダンなポートフォリオサイトを作って」と依頼します。

現在、Skillアップロードは対象の **ChatGPT Business・Enterprise・Healthcare・Edu** で、ワークスペース設定にも依存します。Skills項目が表示されない場合、そのアカウントでは利用できない可能性があります。[ChatGPT公式ガイド](https://help.openai.com/ja-jp/articles/20001066-skills-in-chatgpt)。

### Claude（Web・デスクトップのチャット）

1. ZIPをダウンロードします。
2. **Customize → Skills → + → Create skill → Upload a skill** からZIPをアップロードします。
3. `tsumu` を有効にして「Tsumuでサイトを作って」と依頼します。

`SKILL.md` だけをアップロードすると参照ファイルが利用できません。ZIP一式を登録してください。[Claude公式ガイド](https://support.claude.com/ja/articles/12512180-claude-でスキルを使用する)。

### Claude Code

ZIPをダウンロードし、全プロジェクトで使用する場合は次のように展開します。プロジェクト限定なら `~/.claude/skills` の代わりに `.claude/skills` に展開します。

```sh
mkdir -p ~/.claude/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.claude/skills
```

必要に応じてセッションを再起動し、`tsumu` Skillの利用を依頼します。

### Cursor

全プロジェクトで使う場合は `~/.cursor/skills`、特定プロジェクトで使う場合は `.cursor/skills` に展開します。

```sh
mkdir -p ~/.cursor/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.cursor/skills
```

Cursorが `tsumu/SKILL.md` と参照ファイルを読み込みます。[Cursor公式ガイド](https://cursor.com/docs/skills)。

### Codex（CLI・IDE・アプリ）

ユーザー全体なら `~/.agents/skills`、現在のプロジェクトだけなら `.agents/skills` に展開します。

```sh
mkdir -p ~/.agents/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.agents/skills
```

新しいCodexセッションを開始してSkillを利用します。[OpenAI公式ガイド](https://developers.openai.com/api/reference/cli)。

### Gemini CLI

ユーザー単位なら `~/.gemini/skills`（`~/.agents/skills` も対応）に展開します。

```sh
mkdir -p ~/.gemini/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.gemini/skills
```

`/skills list` または `gemini skills list` で `tsumu` が表示されるか確認します。[Gemini CLI公式ガイド](https://geminicli.com/docs/cli/skills/)。

### Google Antigravity

ユーザー全体で使うなら `~/.gemini/config/skills`、プロジェクト限定なら `.agents/skills` に展開します。

```sh
mkdir -p ~/.gemini/config/skills
unzip -o ~/Downloads/tsumu-skill.zip -d ~/.gemini/config/skills
```

新しいセッションで `tsumu` Skillを呼び出してください。[Antigravity公式ガイド](https://codelabs.developers.google.com/getting-started-agy-ide?hl=ja)。

## SkillとMCP接続の違い

**Skillの導入だけでは、Tsumu MCPへの接続は行われません。**

- **Tsumu MCP接続・認可済み**：`get_site_doc_spec` と `stage_site_doc` で新規サイトを一時保存し、実際に返された非公開インポートリンクを提示できます。リンクだけでは公開・デプロイされません。
- **MCP未接続**：Tsumuで読み込める `doc.json` を生成します。参照ファイルを取得できない場合も、Skill本文に含まれるSiteDocのひな形を利用します。

MCP対応アプリでは `https://mcp.tsumu.ebii.net/mcp` を接続し、新規サイト作成だけの認可を選ぶと、既存サイトの接続コードなしで新規作成できます。詳しくは[Tsumu MCPの接続ガイド](https://mcp.tsumu.ebii.net/)をご覧ください。MCP対応状況はアプリによって異なります。

## 動作確認とトラブル対応

「tsumu Skillを使って、洗練されたランディングページを作って」と依頼します。正常に動けば、MCP利用時はインポートリンク、MCP未接続時は `doc.json` が得られます。デザイン説明だけで終了してはいけません。

AIが `references/site-doc.md` を見つけられない場合、`SKILL.md` だけでなく**ZIP全体**を再導入してください。MCP未接続の通知が出ても、ファイル生成は可能です。

ZIPは [`dist/tsumu-skill.zip`](../dist/tsumu-skill.zip) に事前配置しています。メンテナー向け：Skill更新後のみ `npm run skill:package` で再生成してください。CIでリポジトリ内のZIPと生成結果の一致を検証します。
