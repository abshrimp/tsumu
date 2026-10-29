# Adobe Fonts

Tsumu can use Adobe Fonts through **your own Adobe Fonts Web Project**. It does not download, store, or redistribute font files.

1. Sign in to [Adobe Fonts](https://fonts.adobe.com/) with an eligible Adobe account.
2. Add the desired font to a **Web Project**, then publish it in Adobe Fonts.
3. Open Tsumu's **Text → Font → + → Adobe Fonts** dedicated dialog.
4. Enter the **seven-character Web Project ID** or its URL, for example `https://use.typekit.net/abcdefg.js`.
5. Tsumu checks the **publicly published font list** in Adobe Fonts and displays the available families. Select the font you want and click **Add**. No HTML or JavaScript code needs to be pasted.

If the Adobe metadata API is unavailable, Tsumu also checks Adobe's CSS and JavaScript font delivery URLs. This can distinguish a reachable project from a missing one, and it may recover the CSS family list for non-Japanese fonts. **Japanese fonts may not publish a CSS family listing** because they require dynamic JavaScript subsetting.

To find your **Project ID**, open [Adobe Fonts → Manage fonts → Web Projects](https://fonts.adobe.com/my_fonts#web_projects-section). If you have not created a project, open a font's page and use its **</>** button to create one.

If the published family list cannot be retrieved, the dialog links to Adobe Fonts so you can check publication and try again. Fonts already registered from that project remain selectable from Tsumu's saved settings. New fonts require a published family to appear in the project list. **There is no manual CSS font-family input.** The dialog's **How to add Adobe Fonts** link opens the built-in help instructions.

The public Adobe response can indicate an unknown or unpublished project. It **cannot establish whether a user's Adobe subscription has expired**. An unreachable project is therefore never automatically labeled as expired.

Tsumu stores only the project ID, font-family name, and loading method. It never stores or executes arbitrary embed scripts.

The generated Next.js, React, HTML, Vue, Nuxt and SvelteKit projects embed Adobe's hosted CSS or JavaScript. The editor preview also loads the selected Adobe Web Project. Adobe may take a few minutes to publish Web Project changes. If the Adobe request fails, the page uses the CSS fallback font.

**Licensing:** You must have permission to use the Adobe Fonts Web Project on your website. Adobe does not permit uploading the font files to a site builder or self-hosting them. If your Adobe subscription ends, the hosted fonts stop working. See the [Adobe web-font license](https://helpx.adobe.com/fonts/web/font-licensing/webfont-licensing.html).

## Data format

`SiteDoc.customFonts` holds the Google Fonts list, and the optional `SiteDoc.adobeFonts` array holds Adobe Fonts Web Projects:

```json
{
  "adobeFonts": [
    { "family": "acumin-pro", "kitId": "abc1234", "loading": "css" },
    { "family": "source-han-sans-japanese", "kitId": "def5678", "loading": "dynamic" }
  ]
}
```

When `adobeFonts` is omitted, no Adobe Web Projects are configured.

If you want to add Adobe Fonts directly to an exported `doc.json`, add `adobeFonts` as shown above and use the exact `family` as the node's `fontFamily` value. Re-import the edited document. For ZIP exports, the editable data lives in `_tsumu/doc.json`.

## 日本語

Adobe FontsでWebプロジェクトにフォントを登録したら、Tsumuの「テキスト → フォント → ＋ → Adobe Fonts」を開きます。**7文字のWebプロジェクトID**か `https://use.typekit.net/xxxxxxx.js` のURLを入力すると、公開済みのフォントを一覧表示します。追加したいフォントを選び、「追加」を押してください。

HTMLやJavaScriptの埋め込みコードを貼り付ける必要はありません。まだWebプロジェクトを作っていない場合は、モーダルのリンクからAdobe Fontsを開けます。

**プロジェクトID**は [Adobe Fontsの「フォントを管理」→「Webプロジェクト」](https://fonts.adobe.com/my_fonts#web_projects-section) に表示されます。まだ作成していない場合は、各フォントのページの「</>」ボタンから作成してください。Tsumuのフォント追加モーダルには「Adobe Fontsの追加方法」のヘルプがあります。

Adobe側のフォント一覧APIを取得できない場合は、フォント配信先も確認します。登録済みのフォントはTsumuの保存データから選べますが、新規フォントの追加には公開済みのフォント一覧が必要です。**手動入力欄は設けていません。** 一覧が表示されない場合はAdobe側のプロジェクト設定を確認してください。通信エラーは期限切れを意味しません。

`SiteDoc.customFonts` は Google Fonts、`SiteDoc.adobeFonts` は Adobe Fonts の Web プロジェクトを保持します。
