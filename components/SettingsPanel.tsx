"use client";

import { isEnterKey } from "../lib/keys";
import {
  Code2,
  Component,
  Search,
  Landmark,
  LayoutPanelTop,
  Menu,
  Newspaper,
  PanelBottom,
  PanelTop,
  RectangleHorizontal,
  Square,
  TextCursor,
  Wand2,
} from "lucide-react";
import { useId, useState } from "react";
import dynamic from "next/dynamic";
import { componentOf, useEditor } from "../lib/store";
import {
  cleanVarName,
  fieldLabel,
  listFromOf,
  findItemsCandidates,
  scopeAt,
  pageArrays,
  previewDataVars,
  nodeTextTemplate,
  varNamesAt,
  varSamplesAt,
} from "../lib/data";
import { nodeAssetSrc } from "../lib/assets";
import { embedSrc } from "../lib/embed";
import { normalizeCustomTag, SEMANTIC_OPTIONS } from "../lib/tags";
import type { FieldContent, InputType, LinkSetting, Semantic } from "../lib/types";
import { fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../lib/fields";
import { Icon } from "./icons";
import { CommitInput, CommitTextarea, Dropdown, InfoTip, Seg, VarInput } from "./controls";
import { ScriptSummary } from "./ScriptEditor";
import { AssetGrid } from "./ImagePicker";
import { scriptsOf } from "../lib/script";
import { tr } from "../lib/i18n";

// lucide全アイコンを含むため遅延読み込み
const IconPicker = dynamic(() => import("./IconPicker"), {
  loading: () => <p className="hint">{tr("Loading icons…")}</p>,
});

const SEMANTIC_ICONS: Record<Semantic, React.ReactNode> = {
  auto: <Wand2 size={13} />,
  form: <Search size={13} />,
  button: <RectangleHorizontal size={13} />,
  section: <LayoutPanelTop size={13} />,
  header: <PanelTop size={13} />,
  nav: <Menu size={13} />,
  main: <Landmark size={13} />,
  article: <Newspaper size={13} />,
  footer: <PanelBottom size={13} />,
  div: <Square size={13} />,
  span: <TextCursor size={13} />,
  custom: <Code2 size={13} />,
};

const INPUT_TYPE_OPTIONS: { value: InputType; label: string }[] = [
  { value: "text", label: tr("text", "text_variant_1") },
  { value: "email", label: tr("email (email address)") },
  { value: "password", label: tr("password") },
  { value: "number", label: tr("number") },
  { value: "tel", label: tr("tel (phone number)") },
  { value: "url", label: tr("url") },
  { value: "search", label: tr("search") },
  { value: "date", label: tr("date") },
  { value: "time", label: tr("time") },
  { value: "datetime-local", label: tr("datetime-local (date and time)") },
  { value: "month", label: tr("month") },
  { value: "week", label: tr("week") },
  { value: "color", label: tr("color", "color_variant_1") },
  { value: "range", label: tr("range (slider)") },
];

export default function SettingsPanel({ nodeId }: { nodeId: string }) {
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const scriptEditorOpen = useEditor((s) => !!s.scriptEditor);
  const openScriptEditor = useEditor((s) => s.openScriptEditor);
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const updateNode = useEditor((s) => s.updateNode);
  const deleteNodes = useEditor((s) => s.deleteNodes);
  const duplicateNodes = useEditor((s) => s.duplicateNodes);
  const updateTargets = useEditor((s) => s.updateTargets);
  const selectedIds = useEditor((s) => s.selectedIds);
  const setEditingComponent = useEditor((s) => s.setEditingComponent);
  const detachInstance = useEditor((s) => s.detachInstance);
  const createComponent = useEditor((s) => s.createComponent);
  const createList = useEditor((s) => s.createList);

  const node = doc.nodes[nodeId];
  if (!node) return null;

  /** 複製・削除の対象（複数選んでいて、この要素も含まれていれば選択中の全要素） */
  const targetIds =
    selectedIds.length > 1 && selectedIds.includes(nodeId) ? selectedIds : [nodeId];
  const isSlugPg = !!doc.pages[activePageId]?.slug.includes("[slug]");
  const inComponent = !!componentOf(doc, nodeId);
  /** URL入力などの {変数} 予測変換の候補 */
  const varNames = varNamesAt(doc, activePageId, nodeId);
  const varSamples =
    node.type === "image" ? varSamplesAt(doc, activePageId, nodeId) : undefined;

  /** 同じページ内でのID属性の重複数（自身含む） */
  let dupIdCount = 0;
  if (node.attrId) {
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = doc.nodes[id];
      if (!n) return;
      if (n.type === "instance") {
        const comp = doc.components?.[n.componentId ?? ""];
        if (comp) walk(comp.rootId);
        return;
      }
      if (n.attrId === node.attrId) dupIdCount++;
      n.children.forEach(walk);
    };
    doc.pages[activePageId]?.children.forEach(walk);
  }

  const master = node.type === "instance" ? doc.components?.[node.componentId ?? ""] : undefined;
  const masterRoot = master ? doc.nodes[master.rootId] : undefined;
  const masterId = masterRoot?.type !== "instance" ? masterRoot?.attrId : undefined;
  const scripts = scriptsOf(node);

  return (
    <div className="panel-body" data-tutorial="settings-panel">
      <div className="sec">
        <div className="sec-body" style={{ marginTop: 0 }}>
          <div className="row" data-tutorial="settings-name">
            <label htmlFor={`settings-${nodeId}-name`}>{tr("Name")}</label>
            <CommitInput
              key={`${nodeId}-name`}
              id={`settings-${nodeId}-name`}
              className="input"
              value={node.name}
              onCommit={(v) => updateNode(nodeId, { name: v.trim() || node.name })}
              onKeyDown={(e) => {
                if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <div className="row" data-tutorial="settings-id">
            <label className="lbl-info" htmlFor={`settings-${nodeId}-id`}>
              {tr("ID attribute")}
              <InfoTip
                text={
                  node.attrId && node.type !== "field" && !!nodeTextTemplate(doc, node)
                    ? tr("This element's value can be inserted into data URLs and links as {{attrId}}.", { attrId: node.attrId })
                    : tr("Used as the anchor for in-page links, and as the name when inserting the value as a {variable}.")
                }
              />
            </label>
            <CommitInput
              key={`${nodeId}-id`}
              id={`settings-${nodeId}-id`}
              className="input"
              value={node.attrId ?? ""}
              placeholder={tr("Anchor / {variable} name")}
              // {ID} の変数・スクリプトの対象として使える名前にそろえる（ラジオのグループ名と同じ規則。
              // 空白・引用符・「.」（中の項目をたどる記号）などを含むと、{ID} に値が入らない）
              onCommit={(v) => updateNode(nodeId, { attrId: cleanVarName(v.trim()) || undefined })}
              onKeyDown={(e) => {
                if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          {masterId && node.attrId && masterId !== node.attrId && (
            <p className="hint" style={{ margin: "-4px 0 0", color: "var(--warn)" }}>
              {tr("The master ID “{id}” takes priority. This instance’s ID will not be published.", { id: masterId })}
            </p>
          )}
          {node.attrId === "slug" && isSlugPg && (
            <p
              className="hint"
              style={{ margin: "-4px 0 0", color: "var(--warn)" }}
            >
              {tr("The ID \"slug\" conflicts with this page's {slug} variable. Use a different ID.")}
            </p>
          )}
          {dupIdCount > 1 && (
            <p
              className="hint"
              style={{ margin: "-4px 0 0", color: "var(--warn)" }}
            >
              {tr("The ID \"{id}\" is used by {n} elements on this page. Variables and anchors won't work correctly, so give each a unique ID.", {
                id: node.attrId ?? "",
                n: dupIdCount,
              })}
            </p>
          )}
          <div className="settings-node-actions">
            <button className="btn btn-sm" onClick={() => duplicateNodes(targetIds)}>
              <Icon name="copy" size={12} />
              {tr("Duplicate")}
            </button>
            <button
              className={`btn btn-sm${node.locked ? " is-on" : ""}`}
              aria-pressed={!!node.locked}
              data-tip={
                node.locked
                  ? tr("Unlock so the element can be moved and deleted on the canvas and in Layers again")
                  : tr("Prevent moving, resizing and deleting on the canvas and in Layers (styles can still be changed)")
              }
              onClick={() => {
                const lock = !node.locked;
                updateTargets(node.id, (n) => {
                  if (lock) n.locked = true;
                  else delete n.locked;
                });
              }}
            >
              <Icon name={node.locked ? "lock" : "unlock"} size={12} />
              {node.locked ? tr("Locked") : tr("Lock")}
            </button>
            <button
              className="btn btn-sm"
              style={{ color: "var(--danger)" }}
              disabled={!!node.locked}
              data-tip={node.locked ? tr("Can't delete while locked") : undefined}
              onClick={() => deleteNodes(targetIds)}
            >
              <Icon name="trash" size={12} />
              {tr("Delete")}
            </button>
          </div>
          {node.type === "box" && !inComponent && (
            <div className="settings-node-actions" data-tutorial="settings-make">
              <button
                className="btn btn-sm"
                data-tip={tr("Turn into a reusable part for multiple pages (edits to the main component apply everywhere)")}
                onClick={() => createComponent(nodeId)}
              >
                <Component size={12} />
                {tr("Create component")}
              </button>
              <button
                className="btn btn-sm"
                data-tip={tr("Create a list display using this box as a template for each data item")}
                onClick={() => createList(nodeId)}
              >
                <Icon name="list" size={12} />
                {tr("Turn into list display")}
              </button>
            </div>
          )}
        </div>
      </div>


      {node.type === "instance" && (
        <div className="sec" data-tutorial="settings-component">
          <div className="sec-head is-open">
            <span className="sec-title">
              {tr("Component — {name}", { name: doc.components?.[node.componentId ?? ""]?.name ?? "?" })}
            </span>
            <InfoTip text={tr("This is an instance of a component. To change its content, edit the main component (changes apply everywhere it's used).")} />
          </div>
          <div className="sec-body">
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-sm"
                onClick={() =>
                  node.componentId && setEditingComponent(node.componentId)
                }
              >
                {tr("Edit main component")}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => detachInstance(nodeId)}
              >
                {tr("Detach instance")}
              </button>
            </div>
          </div>
        </div>
      )}

      {node.type === "list" && node.list && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("List display")}</span>
            <InfoTip
              text={tr("The first item in the list display is the template card. Type \"{\" in its text and pick a field to apply it to every card.\nSort and filter with the \"Sort\" and \"Filter\" script actions.")}
            />
          </div>
          <div className="sec-body">
            {(() => {
              const from = node.list.from ?? "";
              // 選べるのは、スクリプトで変数・リストに入れた一覧だけ
              //（取得したデータの中を自動で探した一覧は出さない）
              const arrays = pageArrays(doc, activePageId);
              // 入れ子のリストでは、外側のリスト表示の項目が持つ一覧（各商品の tags など）も並べられる
              const outerItem = scopeAt(doc, activePageId, nodeId, { inside: false }).item;
              const nested = outerItem
                ? findItemsCandidates(outerItem).filter(
                    (c) =>
                      c.path &&
                      !arrays.some((a) => a.name === c.path)
                  )
                : [];
              const samples = previewDataVars(doc, activePageId);
              const options = [
                ...arrays.map((a) => {
                  const v = samples[a.name];
                  return {
                    value: a.name,
                    label: a.name,
                    desc: a.client
                      ? tr("List · set after the page opens")
                      : Array.isArray(v)
                        ? tr("List · {length} sample items", { length: v.length })
                        : tr("List", "list_variant_1"),
                  };
                }),
                ...nested.map((c) => ({
                  value: c.path,
                  label: fieldLabel(c.path),
                  desc: tr("Outer list display item · {count} sample items", { count: c.count }),
                })),
              ];
              return (
                <>
                  <div className="row">
                    <span className="lbl">{tr("List to display")}</span>
                    <Dropdown
                      value={from}
                      placeholder={tr("Select…")}
                      options={[
                        ...options,
                        ...(from && !options.some((o) => o.value === from)
                          ? [
                              {
                                value: from,
                                label: tr("{p1} (not a list)", { p1: fieldLabel(from) }),
                                desc: tr("Store it in a variable with a script to make it selectable"),
                              },
                            ]
                          : []),
                      ]}
                      onChange={(v) =>
                        updateNode(nodeId, { list: { ...node.list!, from: v } })
                      }
                    />
                  </div>
                  {!options.length && (
                    <>
                      <button
                        className="btn btn-sm"
                        style={{ justifyContent: "center" }}
                        data-tip={tr("Store data in a variable or split text into a list with a script, and it will appear here")}
                        onClick={() => openScriptEditor({ focusNodeId: nodeId })}
                      >
                        {tr("Create a list with a script")}
                      </button>
                    </>
                  )}
                </>
              );
            })()}
            {(() => {
              if (!listFromOf(node)) return null;
              return (
                <>
                  <div className="row">
                    <label htmlFor={`settings-${nodeId}-limit`}>{tr("Items to show")}</label>
                    {/* 空欄 = すべて表示 */}
                    <input
                      key={`${nodeId}-limit-${node.list.limit ?? ""}`}
                      id={`settings-${nodeId}-limit`}
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={node.list.limit ?? ""}
                      placeholder={tr("All")}
                      onBlur={(e) => {
                        const n = Math.floor(Number(e.target.value));
                        updateNode(nodeId, {
                          list: {
                            ...node.list!,
                            limit: e.target.value.trim() && n > 0 ? n : undefined,
                          },
                        });
                      }}
                      onKeyDown={(e) => {
                        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {node.type === "box" && (
        <div className="sec" data-tutorial="settings-semantic">
          <div className="sec-head is-open">
            <span>{tr("Meaning (output tag)")}</span>
          </div>
          <div className="sec-body">
            <Dropdown
              value={node.semantic}
              truncateDescriptions
              options={SEMANTIC_OPTIONS.map((o) => ({
                value: o.value,
                label:
                  o.value !== "auto" && o.value !== "custom" ? tr("{label} ({value})", { label: o.label, value: o.value }) : o.label,
                desc: o.desc,
                icon: SEMANTIC_ICONS[o.value],
              }))}
              onChange={(v) => updateNode(nodeId, { semantic: v as Semantic })}
            />
            {node.semantic === "custom" && (
              <div className="row" style={{ marginTop: 8 }}>
                <label htmlFor={`settings-${nodeId}-tag`}>{tr("Tag name")}</label>
                <CommitInput
                  key={`${nodeId}-tag`}
                  id={`settings-${nodeId}-tag`}
                  className="input"
                  value={node.customTag ?? ""}
                  placeholder="pre"
                  spellCheck={false}
                  onCommit={(v) => updateNode(nodeId, { customTag: normalizeCustomTag(v) || undefined })}
                  onKeyDown={(e) => {
                    if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                  }}
                />
              </div>
            )}
            {node.semantic === "custom" && (
              <p className="hint">{tr("Outputs a div when empty or when the tag name can't be used")}</p>
            )}
          </div>
        </div>
      )}

      {node.type === "box" && (
        <LinkSettings
          nodeId={nodeId}
          link={node.link}
          varNames={varNames}
          onChange={(link) => updateNode(nodeId, { link })}
        />
      )}

      {node.type !== "instance" && (
        <div
          className="sec"
          data-tutorial={scriptEditorOpen ? undefined : "settings-link"}
        >
          <div className="sec-head is-open">
            <span className="sec-title">{tr("Scripts")}</span>
            <InfoTip
              text={
                tr("Connect triggers like \"when clicked\" to actions like opening a page or showing an element to make it interactive.") +
                (node.link
                  ? tr("\nA script that only opens a page or URL \"when clicked\" is output as a link (a tag).")
                  : "")
              }
            />
          </div>
          <div className="sec-body">
            {scripts.length > 0 && (
              <ScriptSummary
                items={scripts.map((script) => ({ script }))}
                onOpen={(script) =>
                  openScriptEditor({ focusNodeId: nodeId, focusScriptId: script.id })
                }
              />
            )}
            <button
              className="btn"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => openScriptEditor({ focusNodeId: nodeId })}
            >
              {tr("Edit page scripts")}
            </button>
          </div>
        </div>
      )}

      {node.type === "image" && node.image && (
        <div className="sec" data-tutorial="settings-image">
          <div className="sec-head is-open">
            <span>{tr("Image")}</span>
          </div>
          <div className="sec-body">
            <div className="row">
              <label htmlFor={`settings-${nodeId}-image-url`}>URL</label>
              <VarInput
                key={`${nodeId}-src-${node.image.assetId ?? node.image.src}`}
                id={`settings-${nodeId}-image-url`}
                value={node.image.assetId ? "" : node.image.src}
                placeholder={
                  node.image.assetId
                    ? tr("(asset image)")
                    : tr("https:// or {variable}")
                }
                names={varNames}
                samples={varSamples}
                nodeId={nodeId}
                onCommit={(v) => {
                  const src = v.trim();
                  // VarInput also commits an untouched empty asset placeholder on blur.
                  // Keep that asset, but allow an explicitly cleared external URL.
                  if (src || !node.image!.assetId)
                    updateNode(nodeId, {
                      image: { ...node.image!, src, assetId: undefined, assetSuffix: undefined },
                    });
                }}
              />
            </div>
            <button
              type="button"
              className={`btn btn-sm${assetPickerOpen ? " is-on" : ""}`}
              style={{ justifyContent: "center" }}
              onClick={() => setAssetPickerOpen((open) => !open)}
            >
              <Icon name="image" size={12} />
              {tr("Choose from assets")}
            </button>
            {assetPickerOpen && (
              <AssetGrid
                kind="image"
                selectedId={node.image?.assetId}
                onPick={(asset) => {
                  updateNode(nodeId, {
                    image: {
                      ...node.image!,
                      src: nodeAssetSrc(asset),
                      assetId: asset.id, assetSuffix: undefined,
                      width: asset.width,
                      height: asset.height,
                    },
                  });
                  setAssetPickerOpen(false);
                }}
              />
            )}
            <div className="row">
              <label htmlFor={`settings-${nodeId}-alt`}>{tr("Alt text")}</label>
              <CommitInput
                key={`${nodeId}-alt`}
                id={`settings-${nodeId}-alt`}
                className="input"
                value={node.image.alt}
                placeholder={tr("Describe the image (required)")}
                onCommit={(v) => updateNode(nodeId, { image: { ...node.image!, alt: v } })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            {!node.image.alt && (
              <p className="hint" style={{ margin: 0, color: "var(--warn)" }}>
                {tr("No alt text. The pre-publish check will warn about this.")}
              </p>
            )}
            <label
              className="lbl"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                id={`settings-${nodeId}-image-priority`}
                type="checkbox"
                checked={!!node.image.priority}
                onChange={(e) =>
                  updateNode(nodeId, {
                    image: { ...node.image!, priority: e.target.checked },
                  })
                }
              />
              {tr("Load first (for images visible on page load)")}
            </label>
            {node.image.assetId && doc.assets[node.image.assetId]?.svgFilter && (
              <label
                className="lbl"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <input
                  id={`settings-${nodeId}-image-crisp`}
                type="checkbox"
                  checked={node.image.crispShadow !== false}
                  onChange={(e) =>
                    updateNode(nodeId, {
                      image: {
                        ...node.image!,
                        crispShadow: e.target.checked ? undefined : false,
                      },
                    })
                  }
                />
                {tr("Prevent blurry shadows on iPhone (applied when publishing)")}
              </label>
            )}
            <p className="hint" style={{ margin: 0 }}>
              {tr("Original size: {w} × {h}px", { w: node.image.width, h: node.image.height })}
            </p>
          </div>
        </div>
      )}

      {node.type === "icon" && node.icon && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("Icon — {name}", { name: node.icon.name })}</span>
            <InfoTip text={tr("Change the color with Style → Text → Color, and the size with Size.")} />
          </div>
          <div className="sec-body">
            <IconPicker
              value={node.icon.name}
              onSelect={(name, svg) =>
                updateNode(nodeId, { icon: { name, svg }, name: tr("Icon {name}", { name }) })
              }
            />
          </div>
        </div>
      )}

      {node.type === "field" && node.field && node.field.kind !== "submit" && (
        <FieldSettings
          nodeId={nodeId}
          field={node.field}
          hasId={!!fieldVarName(node)}
          varNames={varNames}
          varSamples={varSamplesAt(doc, activePageId, nodeId)}
          onChange={(patch) => updateNode(nodeId, { field: { ...node.field!, ...patch } })}
        />
      )}

      {node.type === "media" && node.media && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{node.media.kind === "video" ? tr("Video") : tr("Audio")}</span>
            <InfoTip text={tr("Enter the URL of a file such as mp4 or mp3. For YouTube, use the YouTube element.")} />
          </div>
          <div className="sec-body">
            <div className="row">
              <label htmlFor={`settings-${nodeId}-media-url`}>{tr("File URL")}</label>
              <CommitInput
                key={`${nodeId}-msrc-${node.media.assetId ?? node.media.src}`}
                id={`settings-${nodeId}-media-url`}
                className="input"
                value={node.media.assetId ? "" : node.media.src}
                placeholder={
                  node.media.assetId
                    ? node.media.kind === "video"
                      ? tr("(asset video)")
                      : tr("(asset audio)")
                    : node.media.kind === "video"
                    ? "https://…/movie.mp4"
                    : "https://…/sound.mp3"
                }
                onCommit={(value) => {
                  updateNode(nodeId, {
                    media: {
                      ...node.media!,
                      src: value.trim(),
                      assetId: undefined, assetSuffix: undefined, sources: undefined,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <button
              type="button"
              className={`btn btn-sm${assetPickerOpen ? " is-on" : ""}`}
              style={{ justifyContent: "center" }}
              onClick={() => setAssetPickerOpen((open) => !open)}
            >
              <Icon name={node.media.kind === "video" ? "video" : "audio"} size={12} />
              {tr("Choose from assets")}
            </button>
            {assetPickerOpen && (
              <AssetGrid
                kind={node.media.kind}
                selectedId={node.media?.assetId}
                emptyText={tr("No matching assets. Add some from the Assets tab in the left panel.")}
                onPick={(asset) => {
                  updateNode(nodeId, {
                    media: { ...node.media!, src: nodeAssetSrc(asset), assetId: asset.id, assetSuffix: undefined, sources: undefined },
                  });
                  setAssetPickerOpen(false);
                }}
              />
            )}
            <div className="stack" style={{ gap: 4 }}>
              {(
                [
                  ["loop", tr("Loop")],
                  ["autoplay", tr("Autoplay (muted)")],
                  ["muted", tr("Mute")],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="lbl"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <input
                    id={`settings-${nodeId}-media-${key}`}
                type="checkbox"
                    checked={!!node.media![key]}
                    onChange={(e) =>
                      updateNode(nodeId, {
                        media: { ...node.media!, [key]: e.target.checked },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {node.type === "embed" && node.embed && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">
              {
                {
                  youtube: "YouTube",
                  map: tr("Google Maps"),
                  url: tr("Embed URL"),
                }[node.embed.kind]
              }
            </span>
            {node.embed.kind === "url" && (
              <InfoTip text={tr("Sites that don't allow embedding may not appear.")} />
            )}
          </div>
          <div className="sec-body">
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor={`settings-${nodeId}-embed-url`}>
                {
                  {
                    youtube: tr("Video URL"),
                    map: tr("Address, place name or map URL"),
                    url: tr("URL of the page to embed"),
                  }[node.embed.kind]
                }
              </label>
              <CommitInput
                key={`${nodeId}-esrc`}
                id={`settings-${nodeId}-embed-url`}
                className="input"
                value={node.embed.src}
                placeholder={
                  {
                    youtube: "https://www.youtube.com/watch?v=…",
                    map: tr("e.g. Eiffel Tower"),
                    url: "https://example.com",
                  }[node.embed.kind]
                }
                onCommit={(v) => updateNode(nodeId, { embed: { ...node.embed!, src: v.trim() } })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            {node.embed.src.trim() && !embedSrc(node.embed) && (
              <p className="hint" style={{ margin: 0, color: "var(--warn)" }}>
                {tr("Couldn't read the URL. Check its format.")}
              </p>
            )}
          </div>
        </div>
      )}

      {node.type === "code" && node.code && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("Custom code (HTML)")}</span>
            <InfoTip text={tr("Embedded as HTML as is.")} />
          </div>
          <div className="sec-body">
            <CommitTextarea
              key={`${nodeId}-code`}
              className="textarea mono"
              rows={10}
              value={node.code.html}
              onCommit={(v) => updateNode(nodeId, { code: { html: v } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- フォーム部品 ---------- */

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  const inputId = useId();
  return (
    <label className="lbl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input id={inputId} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 入力欄の種類ごとの設定（初期値・案内文・範囲・必須など。文字の欄は {変数} を使える） */
function FieldSettings({
  nodeId,
  field: f,
  hasId,
  varNames,
  varSamples,
  onChange,
}: {
  nodeId: string;
  field: FieldContent;
  hasId: boolean;
  varNames: string[];
  varSamples: Record<string, string>;
  onChange: (patch: Partial<FieldContent>) => void;
}) {
  const type = f.kind === "input" ? (f.inputType ?? "text") : null;
  const ranged = !!type && RANGED_INPUTS.has(type);
  const textual = f.kind === "textarea" || (!!type && TEXT_INPUTS.has(type));
  const varField = (key: "defaultValue" | "placeholder" | "label" | "min" | "max" | "step", placeholder: string) => (
    <VarInput
      key={`${nodeId}-${key}-${f[key] ?? ""}`}
      id={`field-${nodeId}-${key}`}
      className="input"
      value={f[key] ?? ""}
      placeholder={placeholder}
      names={varNames}
      samples={varSamples}
      nodeId={nodeId}
      onCommit={(v) => onChange({ [key]: v || undefined })}
    />
  );
  const num = (key: "maxLength" | "rows", placeholder: string) => (
    <CommitInput
      key={`${nodeId}-${key}-${f[key] ?? ""}`}
      id={`field-${nodeId}-${key}`}
      className="input"
      type="number"
      min={1}
      value={f[key] ? String(f[key]) : ""}
      placeholder={placeholder}
      onCommit={(v) => {
        const n = Math.round(Number(v));
        onChange({ [key]: n > 0 ? n : undefined });
      }}
      onKeyDown={(e) => {
        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
      }}
    />
  );
  const rangePh =
    type === "date" ? "2026-01-01" : type === "time" ? "09:00" : type === "month" ? "2026-01" : type === "week" ? "2026-W01" : type === "datetime-local" ? "2026-01-01T09:00" : "";
  return (
    <div className="sec">
      <div className="sec-head is-open">
        <span className="sec-title">{tr("Form field")}</span>
        <InfoTip
          text={
            tr("The ID attribute above becomes the value's name. Write {ID} to insert it into data URLs and more.") +
            tr("\nThe initial value, placeholder and label can use {variables}.")
          }
        />
      </div>
      <div className="sec-body">
        {f.kind === "input" && (
          <div className="row">
            <span className="lbl">type</span>
            <Dropdown
              value={f.inputType ?? "text"}
              options={INPUT_TYPE_OPTIONS}
              onChange={(value) => onChange({ inputType: value as InputType })}
            />
          </div>
        )}
        {f.kind === "radio" && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row">
              <label htmlFor={`field-${nodeId}-group`}>{tr("group")}</label>
              <CommitInput
                key={`${nodeId}-group-${f.group ?? ""}`}
                id={`field-${nodeId}-group`}
                className="input"
                value={f.group ?? ""}
                placeholder="radio"
                onCommit={(v) => onChange({ group: cleanVarName(v.trim()) || undefined })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {f.group
                ? tr("Only one radio button in the same group can be chosen. {{group}} is the value (label) of the chosen button.", { group: f.group })
                : tr("Only one radio button with the same group name can be chosen. The group name becomes the variable holding the chosen button's value.")}
            </p>
          </div>
        )}
        {(f.kind === "checkbox" || f.kind === "radio") && (
          <>
            <div className="row">
              <label htmlFor={`field-${nodeId}-label`}>{tr("Label")}</label>
              {varField("label", f.kind === "radio" ? tr("Also the value when chosen") : "")}
            </div>
            <CheckRow
              checked={!!f.checked}
              label={tr("Checked by default")}
              onChange={(v) => onChange({ checked: v || undefined })}
            />
          </>
        )}
        {(f.kind === "input" || f.kind === "textarea" || f.kind === "select") && (
          <div className="row">
            <label htmlFor={`field-${nodeId}-defaultValue`}>{tr("Default value")}</label>
            {varField(
              "defaultValue",
              f.kind === "select"
                ? tr("Enter text matching an option")
                : type === "color"
                  ? "#000000"
                  : ranged && rangePh
                    ? rangePh
                    : tr("Text entered by default")
            )}
          </div>
        )}
        {(textual || type === "number" || (ranged && type !== "range")) && (
          <div className="row">
            <label htmlFor={`field-${nodeId}-placeholder`}>{tr("Placeholder")}</label>
            {varField("placeholder", tr("Faint text shown when empty"))}
          </div>
        )}
        {ranged && (
          <div className="grid3" style={{ gap: 6 }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor={`field-${nodeId}-min`}>{tr("Min")}</label>
              {varField("min", type === "range" ? "0" : rangePh)}
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor={`field-${nodeId}-max`}>{tr("Max")}</label>
              {varField("max", type === "range" ? "100" : rangePh)}
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor={`field-${nodeId}-step`}>{tr("Step")}</label>
              {varField("step", type === "range" || type === "number" ? "1" : "")}
            </div>
          </div>
        )}
        {textual && (
          <div className="row">
            <label htmlFor={`field-${nodeId}-maxLength`}>{tr("Max length")}</label>
            {num("maxLength", tr("No limit"))}
          </div>
        )}
        {f.kind === "textarea" && (
          <div className="row">
            <label htmlFor={`field-${nodeId}-rows`}>{tr("Rows", "rows_variant_1")}</label>
            {num("rows", "2")}
          </div>
        )}
        {f.kind === "select" && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl" htmlFor={`field-${nodeId}-options`}>{tr("Options (one per line)")}</label>
            <CommitTextarea
              key={`${nodeId}-opts`}
              id={`field-${nodeId}-options`}
              className="textarea"
              rows={4}
              value={(f.options ?? []).map((o) => o.label === o.value ? o.label : o.label + "\t" + o.value).join("\n")}
              onCommit={(v) =>
                onChange({
                  options: v
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [label, ...values] = line.split("\t");
                      return { label, value: values.length ? values.join("\t").trim() : label };
                    }),
                })
              }
            />
          </div>
        )}
        {f.kind === "file" && (
          <>
            <div className="row">
              <label htmlFor={`field-${nodeId}-accept`}>{tr("Type")}</label>
              <CommitInput
                key={`${nodeId}-accept-${f.accept ?? ""}`}
                id={`field-${nodeId}-accept`}
                className="input"
                value={f.accept ?? ""}
                placeholder={tr("e.g. image/*, .pdf (empty = any)")}
                onCommit={(v) => onChange({ accept: v.trim() || undefined })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <CheckRow
              checked={!!f.multiple}
              label={tr("Allow multiple files")}
              onChange={(v) => onChange({ multiple: v || undefined })}
            />
          </>
        )}
        <CheckRow
          checked={!!f.required}
          label={f.kind === "checkbox" ? tr("Required (must be checked to submit)") : tr("Required (must be filled in to submit)")}
          onChange={(v) => onChange({ required: v || undefined })}
        />
        <CheckRow
          checked={!!f.disabled}
          label={tr("Disabled (can't be used)")}
          onChange={(v) => onChange({ disabled: v || undefined })}
        />
        {!hasId && (
          <p className="hint" style={{ margin: 0, color: "var(--warn)" }}>
            {f.kind === "radio"
              ? tr("This field has no group, so its value isn't submitted.")
              : tr("This field has no ID attribute, so its value won't be submitted.")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- リンク ---------- */

/** 押したときに開くURL・ページ（スクリプトの「クリックしたとき → 開く」と同じもの） */
function LinkSettings({
  nodeId,
  link,
  varNames,
  onChange,
}: {
  nodeId: string;
  link: LinkSetting | null;
  varNames: string[];
  onChange: (link: LinkSetting | null) => void;
}) {
  const doc = useEditor((s) => s.doc);
  const kind = link?.kind ?? "none";
  const pos = link?.pos ? { pos: link.pos } : {};
  return (
    <div className="sec">
      <div className="sec-head is-open">
        <span className="sec-title">{tr("Link")}</span>
        <InfoTip
          text={tr("The URL or page opened when this is pressed. It is the same as “When clicked → Open” in the script editor, so changing either changes both. URLs can use {variables} and #ID (a position on the page).")}
        />
      </div>
      <div className="sec-body">
        <Seg
          value={kind}
          options={[
            { value: "none", label: tr("None") },
            { value: "url", label: "URL" },
            { value: "page", label: tr("Pages") },
          ]}
          onChange={(v) =>
            onChange(
              v === "none"
                ? null
                : v === "url"
                  ? { kind: "url", url: link?.kind === "url" ? (link.url ?? "") : "", newTab: link?.newTab, ...pos }
                  : { kind: "page", pageId: link?.kind === "page" ? link.pageId : doc.pageOrder[0], newTab: link?.newTab, ...pos }
            )
          }
        />
        {link?.kind === "url" && (
          <VarInput
            key={`${nodeId}-link-${link.url ?? ""}`}
            className="input"
            value={link.url ?? ""}
            placeholder={tr("https://… · #ID · {variable}")}
            names={varNames}
            nodeId={nodeId}
            onCommit={(v) => onChange({ ...link, url: v.trim() })}
          />
        )}
        {link?.kind === "page" && (
          <Dropdown
            value={link.pageId ?? ""}
            options={doc.pageOrder.map((id) => ({
              value: id,
              label: doc.pages[id].name,
              desc: `/${doc.pages[id].slug}`,
              icon: <Icon name="page" size={13} />,
            }))}
            onChange={(pageId) => onChange({ ...link, pageId })}
          />
        )}
        {link && (
          <label className="lbl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              id={`settings-${nodeId}-new-tab`}
                type="checkbox"
              checked={!!link.newTab}
              onChange={(e) => onChange({ ...link, newTab: e.target.checked || undefined })}
            />
            {tr("Open in a new tab")}
          </label>
        )}
      </div>
    </div>
  );
}
