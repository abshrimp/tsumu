---
name: tsumu
description: Create a NEW editable Tsumu website, portfolio, landing page or multi-page site. Use when the user requests "tsumu いい感じのサイトを作って", "Tsumuでサイトを作って", or "build a Tsumu website". Stage through an authorized Tsumu MCP server and give the exact import link when possible; otherwise create a valid downloadable doc.json or ZIP. Do not use for changes to an existing paired site or for unrelated website builders.
license: MIT
compatibility: An authorized Tsumu MCP connection is optional; file-based site creation works offline without MCP or additional references.
metadata:
  author: abshrimp
---

# Create a site for Tsumu

Use this skill when the user wants a **new** website they can visually edit in Tsumu. Prefer a private MCP import link when staging is available and authorized; otherwise provide a real downloadable `doc.json` or ZIP import file. Do not confuse creating a separate site with adding a page to an existing paired site: use the paired-editor MCP tools for the latter.

## Design first, translate into Tsumu second

**Phase 1 — design a genuinely original site independently of Tsumu's example JSON.**

1. Interpret the brief: purpose, audience, key message, site structure, content priorities, desired action, tone and visual identity. For vague requests, independently choose a coherent creative direction without defaulting to the bundled Studio Notes example or asking unnecessary questions.
2. **Freely design the website before thinking in SiteDoc nodes.** Plan page-by-page content, layouts, section compositions, type scale, color palette, spacing, visual accents and mobile behavior. Avoid automatically reusing the same header, hero, feature cards and contact layout for unrelated briefs.
3. When tools permit, draft a complete standalone HTML/CSS prototype as an *intermediate design exploration*, with behavior notes for interactions. If tools are unavailable, make an equally concrete design blueprint. Do not require a rendered preview when the environment cannot provide one, and do not deliver the prototype in place of an editable Tsumu site.
4. Review and refine the independently designed result before consulting the SiteDoc examples. Do not invent real business addresses, testimonials, products or functioning services.

**Phase 2 — convert the original design into a fully editable Tsumu SiteDoc.**

1. Now consult `get_site_doc_spec` (if MCP is available) or the bundled schema/reference and offline starter to learn **valid fields and relationships only**. The sample is *not* a website template.
2. Build the actual site with original pages, native editable nodes, unique IDs, styles, content and supported interactions. Preserve the design's hierarchy, section variation, layout, color, typography and responsive intent, rather than making a recolored or renamed copy of the reference.
3. Compare the converted result with the independently designed site. If the output differs from the example only in text, palette or images, it is **not complete**: revise its structure and composition. Adapt unsupported visual ideas honestly using valid Tsumu elements; do not invent schema properties.

If the user explicitly requests a particular template, follow that request. The Phase 1 HTML/CSS draft is never the payload of `stage_site_doc`, which requires a complete SiteDoc object, and never replaces a downloadable `doc.json`.

## Read first and handle unavailable resources

1. **When Tsumu MCP is connected:** after forming the original design in Phase 1, call `get_site_doc_spec` before authoring or staging any SiteDoc. Inspect both the returned `guide` and `example`, then call `stage_site_doc` only with an authorized grant. Loading this Skill does **not** automatically connect MCP.
2. **When converting a design to a local file:** after Phase 1, read [the SiteDoc format](references/site-doc.md), [the editable example](references/minimal-site.json), and [the TypeScript model](references/types.ts) **when accessible**. Install or upload the entire `tsumu/` skill folder, not only `SKILL.md`, so these resources can be resolved.
3. **When references cannot be opened:** do **not** stop or ask the user to upload them. Use the self-contained, valid starter below **only to understand JSON shapes** and stay within its known-safe `box` nodes and string-valued CSS declarations. Create a fresh design and node hierarchy instead of copying the sample's Studio Notes structure. Generate a real `doc.json` file even without MCP; if this runtime has no file-writing capability, provide the full JSON in a code block for the user to save.
4. For advanced scripts, components, assets or other node types, read the references or an authoritative current schema rather than inventing fields. If the Tsumu repository is accessible, `lib/types.ts`, `lib/presets.ts` and `lib/site-import-format.ts` take precedence.
5. For an open-ended prompt such as "いい感じのサイトを作って", choose a plausible fictional purpose and visual direction yourself. Build a **polished multi-section** site with purposeful copy, hierarchy, contrast and mobile-friendly spacing. Do not ask the user to choose a theme unless a missing requirement genuinely prevents progress. Do not invent real addresses, customers, testimonials or working services.

### Offline SiteDoc starter

This standalone example is a **complete, importable SiteDoc** that demonstrates safe field shapes when MCP and reference files are inaccessible. **It is not a design template.** Do not reproduce its Studio Notes concept, page order, hero/services composition, colors, copy or node tree by cloning and restyling it. Use its required JSON fields and valid `box` element structure to construct the **original Phase 1 design** with a new hierarchy and unique IDs. This example by itself is not a sufficient final design for a broad request.

```json
{
  "schemaVersion": 1,
  "siteName": "Studio Notes",
  "lang": "ja",
  "pages": {
    "page_home": {
      "id": "page_home",
      "name": "ホーム",
      "slug": "",
      "title": "Studio Notes",
      "description": "架空のクリエイティブスタジオ",
      "children": [
        "node_hero",
        "node_services"
      ]
    }
  },
  "pageOrder": [
    "page_home"
  ],
  "nodes": {
    "node_hero": {
      "id": "node_hero",
      "type": "box",
      "name": "ヒーロー",
      "semantic": "section",
      "text": null,
      "link": null,
      "children": [
        "node_title",
        "node_lead"
      ],
      "styles": {
        "base": {
          "default": {
            "display": "flex",
            "flexDirection": "column",
            "gap": "20px",
            "padding": "80px 24px",
            "backgroundColor": "#0f172a"
          }
        }
      }
    },
    "node_title": {
      "id": "node_title",
      "type": "box",
      "name": "見出し",
      "semantic": "auto",
      "text": {
        "content": "考えを、かたちに。",
        "heading": 1
      },
      "link": null,
      "children": [],
      "styles": {
        "base": {
          "default": {
            "fontSize": "clamp(32px, 6vw, 64px)",
            "fontWeight": "700",
            "lineHeight": "1.2",
            "color": "#ffffff"
          }
        }
      }
    },
    "node_lead": {
      "id": "node_lead",
      "type": "box",
      "name": "紹介文",
      "semantic": "auto",
      "text": {
        "content": "デザインと技術で、新しい体験をつくるスタジオ。",
        "heading": 0
      },
      "link": null,
      "children": [],
      "styles": {
        "base": {
          "default": {
            "fontSize": "18px",
            "lineHeight": "1.8",
            "color": "#cbd5e1"
          }
        }
      }
    },
    "node_services": {
      "id": "node_services",
      "type": "box",
      "name": "サービス",
      "semantic": "section",
      "text": null,
      "link": null,
      "children": [
        "node_services_title",
        "node_services_text"
      ],
      "styles": {
        "base": {
          "default": {
            "display": "flex",
            "flexDirection": "column",
            "gap": "16px",
            "padding": "72px 24px",
            "backgroundColor": "#f8fafc"
          }
        }
      }
    },
    "node_services_title": {
      "id": "node_services_title",
      "type": "box",
      "name": "サービス見出し",
      "semantic": "auto",
      "text": {
        "content": "私たちができること",
        "heading": 2
      },
      "link": null,
      "children": [],
      "styles": {
        "base": {
          "default": {
            "fontSize": "32px",
            "fontWeight": "700",
            "color": "#0f172a"
          }
        }
      }
    },
    "node_services_text": {
      "id": "node_services_text",
      "type": "box",
      "name": "サービス説明",
      "semantic": "auto",
      "text": {
        "content": "Webサイト設計、ビジュアル制作、コンテンツづくりを一貫して考えます。",
        "heading": 0
      },
      "link": null,
      "children": [],
      "styles": {
        "base": {
          "default": {
            "fontSize": "16px",
            "lineHeight": "1.8",
            "color": "#334155"
          }
        }
      }
    }
  },
  "assets": {}
}
```

Keep `schemaVersion: 1`, a nonempty `siteName`, and the `pages`, `pageOrder`, `nodes`, `assets` maps. Each page has `id`, `name`, `slug`, `title`, `description`, `children`; the home page has `slug: ""`. Nodes require `id`, `type`, `name`, `semantic`, `text`, `link`, `children`, `styles`. Use `type: "box"` for headings and paragraphs: `text: { content, heading }` where `heading` is 0–6; a layout container has `text: null`. Set CSS values as strings inside `styles.base.default`. Preserve unique IDs, consistent child references and an acyclic hierarchy.

## Select the output

- **Authorized Tsumu MCP staging (preferred):** generate a complete SiteDoc object and call `stage_site_doc({ doc: <SiteDoc> })` to stage a **separate new** editable site. Use the exact `importUrl` returned by the tool; see [MCP handoff](#mcp-handoff). No existing-site pairing code is required if the user granted new-site creation.
- **No staging tool or no authorization:** create an importable file as described below, even if other reference files are inaccessible (use the inline starter). Never invent an import link. If staging was explicitly requested but failed, report the error clearly; a downloadable file may be offered as an alternative, not presented as a successful upload.
- **No packaged binary assets:** generate `doc.json` containing one valid `SiteDoc`; use `assets: {}` when no assets exist. Inline CSS and native Tsumu elements do not require ZIP packaging. Plain or minified UTF-8 JSON matching `SiteDoc` (`schemaVersion: 1`) is accepted directly.
- **With packaged assets:** generate a DEFLATE-compressed ZIP with `_tsumu/doc.json` (plain minified JSON, not double-compressed), `_tsumu/assets.json`, and the required files (normally in `public/assets/`). The map associates original asset IDs with paths inside the ZIP.
- For modest self-contained assets, a `dataUrl` in `doc.json` is also supported when the resulting document is within import limits.

Do not substitute raw HTML, a generated Next.js project, or an image-only mockup for the editable `SiteDoc`.

## MCP handoff

1. Construct the full native Tsumu `SiteDoc` using the schema returned by `get_site_doc_spec`. Pass an **object** in the `doc` argument to `stage_site_doc`, not a JSON string, HTML, a ZIP, or a wrapper. The serialized SiteDoc must fit within the **12 MiB** staging limit.
2. For images, use verified external URLs or supported small embedded `dataUrl` assets within the size limit. `stage_site_doc` does not upload a separate binary asset archive or resolve imaginary storage keys. If the user needs large packaged assets, deliver a ZIP through the file workflow instead.
3. After a successful tool response, give the requesting user the **exact returned `importUrl`** as a clickable private link and briefly describe what opening it does. The link expires after **one hour** and is consumed after Tsumu confirms a successful import. Treat the complete URL as a bearer secret; do not copy it to unrelated services or logs.
4. A staged link opens Tsumu to **import** the new site. It is not evidence the site has been imported, published, deployed, or added to an existing paired editor. Never claim any of those events without separate confirmation.
5. If `get_site_doc_spec`, `stage_site_doc`, or authorization is unavailable, use the file workflow. If staging fails, report the real failure and do not reconstruct a link from guessed identifiers. `create_site` only makes an empty browser-local site; it is not a replacement for `stage_site_doc`.

## Create and verify

0. Verify design fidelity and originality against the independent Phase 1 layout. The SiteDoc must express that design and not merely reskin the offline starter or another reference. If it is too similar, redesign the native node hierarchy before delivery.
1. Generate stable, unique page, node, script, component and asset IDs; ensure every reference resolves. Use proper `pages`, `pageOrder`, `nodes`, and `assets`.
2. Build layout with editable nodes and `styles.base.default`; use real `DocNode` types and properly shaped scripts. Read the reference for correct field names and nested structures.
3. If packaging assets, keep their original IDs and write an `_tsumu/assets.json` map of archive paths. Do not use remote Tsumu storage keys as local asset paths.
4. Validate the file and archive using the checks and size limits in [the format reference](references/site-doc.md). If possible, load it in Tsumu and verify that the editor can select and edit its elements.
5. Deliver the successful MCP import link **or**, when staging is unavailable, a real downloadable file. If this runtime cannot create files, include the **complete valid JSON** in a code block with instructions to save it as `doc.json`, rather than refusing to build the site. The user can drop a file onto the Tsumu homepage or select **Import**. State which output was actually created.

Do not silently omit images or other required assets. If an essential asset cannot be created, explain the limitation.
