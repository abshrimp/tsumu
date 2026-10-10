# Adobe Fonts

Tsumu can use Adobe Fonts through **your own Adobe Fonts Web Project**. It does not download, store, or redistribute font files.

1. Sign in to [Adobe Fonts](https://fonts.adobe.com/) with an eligible Adobe account.
2. Add the font to a Web Project, then save the project in Adobe Fonts.
3. In Adobe Fonts' Web Project dialog, copy the **entire HTML embed code**. Adobe provides a `<script>` snippet for East Asian fonts (including Japanese) and may provide a stylesheet `<link>` for other fonts.
4. In Tsumu, choose **Text → Font → + → Adobe Fonts** and paste the embed code into **Adobe Fonts embed code**. Tsumu detects the seven-character Web Project ID and whether the loader is JavaScript or CSS.
5. Paste the CSS `font-family` declaration displayed by Adobe into the **Font family** field (or enter just its family name). For example: `font-family: "poprumcute", sans-serif;`. If the declaration was pasted together with the embed code, Tsumu detects it automatically.
6. Click **Add**. The font becomes selectable in the same font dropdown.

Tsumu **parses, but never executes or stores, the pasted script**. It generates its own hosted Adobe Fonts loader from the detected ID and loading method. Pasting multiple different Web Projects at once is rejected.\n\nThe generated Next.js, React, HTML, Vue, Nuxt and SvelteKit projects embed Adobe's hosted CSS or JavaScript. The editor preview also loads the selected Adobe Web Project. Adobe may take a few minutes to publish Web Project changes. If the Adobe request fails, the page uses the CSS fallback font.

**Licensing:** You must have permission to use the Adobe Fonts Web Project on your website. Adobe does not permit uploading the font files to a site builder or self-hosting them. If your Adobe subscription ends, the hosted fonts stop working. See the [Adobe web-font license](https://helpx.adobe.com/fonts/web/font-licensing/webfont-licensing.html).

## Data format

The existing `SiteDoc.customFonts` array remains the Google Fonts list, unchanged. Adobe Fonts are stored in a separate optional `SiteDoc.adobeFonts` array:

```json
{
  "adobeFonts": [
    { "family": "acumin-pro", "kitId": "abc1234", "loading": "css" },
    { "family": "source-han-sans-japanese", "kitId": "def5678", "loading": "dynamic" }
  ]
}
```

**No migration is needed for previously saved documents.** They have no `adobeFonts` field, which means no Adobe Web Projects are configured. The existing Google Fonts entries and node `fontFamily` values are not modified. Tsumu does not maintain any legacy Adobe embed format or compatibility path.

If you want to add Adobe Fonts directly to an exported `doc.json`, add `adobeFonts` as shown above and use the exact `family` as the node's `fontFamily` value. Re-import the edited document. For ZIP exports, the editable data lives in `_tsumu/doc.json`.

## 日本語

Adobe FontsのWebプロジェクトにフォントを登録し、Adobeの画面に表示される**埋め込みコードを丸ごとコピー**します。Tsumuの「テキスト → フォント → ＋ → Adobe Fonts」に貼り付けると、WebプロジェクトIDと読み込み方式が自動判定されます。さらにAdobeのCSS欄にある `font-family: "poprumcute", sans-serif;` などの指定をフォント名の欄に貼り付けてください。JavaScriptコードは解析されるだけで、そのまま実行・保存されません。

既存データの型は変更しておらず、`adobeFonts` という任意フィールドを追加するだけです。**データ変換は不要**です。Google Fontsの`customFonts`はそのまま利用できます。
