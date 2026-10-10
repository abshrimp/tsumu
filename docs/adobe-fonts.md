# Adobe Fonts

Tsumu can use Adobe Fonts through **your own Adobe Fonts Web Project**. It does not download, store, or redistribute font files.

1. Sign in to [Adobe Fonts](https://fonts.adobe.com/) with an eligible Adobe account.
2. Add the font to a Web Project, then save the project in Adobe Fonts.
3. In Tsumu's **Text → Font → + → Adobe Fonts**, enter:
   - **CSS font-family**: copy the exact CSS family name from Adobe's project editor (for example, `source-han-sans-japanese`).
   - **Web Project ID**: the seven characters in `https://use.typekit.net/xxxxxxx.css` or `https://use.typekit.net/xxxxxxx.js`.
   - **Loading**: **CSS** for non-East-Asian web fonts, or **JavaScript** for East Asian fonts (including Japanese), which require Adobe's dynamic subsetting.
4. Select the newly added family from the same font dropdown.

The generated Next.js, React, HTML, Vue, Nuxt and SvelteKit projects embed Adobe's hosted CSS or JavaScript. The editor preview also loads the selected Adobe Web Project. Adobe may take a few minutes to publish Web Project changes. If the Adobe request fails, the page uses the CSS fallback font.

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

Adobe FontsのWebプロジェクトにフォントを登録し、Tsumuの「テキスト → フォント → ＋ → Adobe Fonts」からCSSファミリー名・WebプロジェクトID・読み込み方式を指定します。**日本語フォントは「JavaScript（日本語など）」**を選択してください。

既存データの型は変更しておらず、`adobeFonts` という任意フィールドを追加するだけです。**データ変換は不要**です。Google Fontsの`customFonts`はそのまま利用できます。
