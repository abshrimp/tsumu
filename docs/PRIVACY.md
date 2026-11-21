# Tsumu Editor Privacy Policy

This policy covers the hosted website editor at [tsumu.ebii.net](https://tsumu.ebii.net/). Other people can run their own copies of Tsumu with different storage and sign-in settings. A site published with Tsumu has its own operator.

## What stays in your browser

You can open the hosted editor and create a site without signing in. It saves your site list, page content, scripts, imported files and assets in your browser so you can reopen and edit them. The hosted editor uses browser storage, including IndexedDB and local storage. It also uses a cookie to remember the interface language. Ordinary editing does not upload a backup of your project to a Tsumu account.

Anyone with access to the same browser profile may be able to open these sites. Use the home screen to delete a site. To remove all local projects, settings and saved connections, clear site data for `tsumu.ebii.net` in your browser. Export a backup ZIP first if you want to keep a copy.

## When data leaves your browser

| When | What is processed and why |
| --- | --- |
| You open the editor | Cloudflare delivers the application and processes connection information such as your IP address, request URL and browser headers. Browsers that support network error reporting may also send diagnostic reports to Cloudflare. The editor loads its preset fonts from Google Fonts, which receives requests from your browser. |
| Your project uses external content | Loading a remote image, embed, font or other resource contacts its provider. If you configure Adobe Fonts, the editor loads the selected kit from Adobe. When you preview a data request through Tsumu, its server forwards the configured URL, permitted headers and request body to the destination. |
| You publish to Netlify | Netlify signs you in and authorizes publishing. Your browser stores the access token, account details and selected team and project identifiers. Tsumu's server uses the token to make the Netlify requests you choose, including uploading generated files and assets. The published content is available according to the settings of your Netlify project. |
| You connect an external AI app | The official MCP authorization screen can show site names, identifiers and editing eligibility so you can select sites. After you authorize access, the relay and the selected AI app process requested page or element content and editing operations. The relay uses cookies and connection identifiers to maintain the grant. Opening an AI-generated import link retrieves the temporary draft so you can save it in your browser. |

The hosted editor's built-in **Ask AI** feature is disabled as of November 21, 2026. Connecting your own AI app through MCP is a separate choice. Its provider's privacy settings apply to information it receives. See the [Tsumu MCP Privacy Policy](https://github.com/abshrimp/tsumu-mcp/blob/main/docs/PRIVACY.md).

## External copies and access

Clearing browser data removes your local copy. Downloaded backups, Netlify deployments and information already sent to an AI app are managed separately. To take a published site offline or revoke Tsumu's Netlify authorization, use your Netlify account. To end an MCP connection, open the site's connection dialog and choose **Disconnect and revoke**. You can also remove the connection in your AI app.

The providers describe their own handling and retention of information in their notices. See [Cloudflare](https://www.cloudflare.com/privacypolicy/), [Google Fonts](https://developers.google.com/fonts/faq/privacy), [Adobe](https://www.adobe.com/privacy/policy.html) and [Netlify](https://www.netlify.com/privacy/).

## Contact

For a privacy question or a request concerning your information, email [contact@ebii.net](mailto:contact@ebii.net). Include the feature concerned and enough detail to identify the request. Keep tokens, connection codes, private import links and unpublished site content out of your message.
