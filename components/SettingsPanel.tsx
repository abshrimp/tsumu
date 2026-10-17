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
import { useState } from "react";
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
import { assetSrc } from "../lib/assets";
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
  loading: () => <p className="hint">{tr("アイコン一覧を読み込み中…")}</p>,
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
  { value: "text", label: tr("text（テキスト）") },
  { value: "email", label: tr("email（メールアドレス）") },
  { value: "password", label: tr("password（パスワード）") },
  { value: "number", label: tr("number（数値）") },
  { value: "tel", label: tr("tel（電話番号）") },
  { value: "url", label: tr("url（URL）") },
  { value: "search", label: tr("search（検索）") },
  { value: "date", label: tr("date（日付）") },
  { value: "time", label: tr("time（時刻）") },
  { value: "datetime-local", label: tr("datetime-local（日時）") },
  { value: "month", label: tr("month（月）") },
  { value: "week", label: tr("week（週）") },
  { value: "color", label: tr("color（色）") },
  { value: "range", label: tr("range（範囲）") },
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

  const scripts = scriptsOf(node);

  return (
    <div className="panel-body" data-tutorial="settings-panel">
      <div className="sec">
        <div className="sec-body" style={{ marginTop: 0 }}>
          <div className="row" data-tutorial="settings-name">
            <label>{tr("名前")}</label>
            <CommitInput
              key={`${nodeId}-name`}
              className="input"
              value={node.name}
              onCommit={(v) => updateNode(nodeId, { name: v.trim() || node.name })}
              onKeyDown={(e) => {
                if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <div className="row" data-tutorial="settings-id">
            <label className="lbl-info">
              {tr("ID属性")}
              <InfoTip
                text={
                  node.attrId && node.type !== "field" && !!nodeTextTemplate(doc, node)
                    ? tr("この要素の値は {{attrId}} として、データの取得先URLやリンクに差し込めます。", { attrId: node.attrId })
                    : tr("ページ内リンクのアンカーや、{変数} として値を差し込むときの名前になります。")
                }
              />
            </label>
            <CommitInput
              key={`${nodeId}-id`}
              className="input"
              value={node.attrId ?? ""}
              placeholder={tr("アンカー・{変数} の名前")}
              // {ID} の変数・スクリプトの対象として使える名前にそろえる（ラジオのグループ名と同じ規則。
              // 空白・引用符・「.」（中の項目をたどる記号）などを含むと、{ID} に値が入らない）
              onCommit={(v) => updateNode(nodeId, { attrId: cleanVarName(v.trim()) || undefined })}
              onKeyDown={(e) => {
                if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          {node.attrId === "slug" && isSlugPg && (
            <p
              className="hint"
              style={{ margin: "-4px 0 0", color: "var(--warn)" }}
            >
              {tr("ID「slug」は、このページの変数 {slug} と重なっています。別のIDにしてください。")}
            </p>
          )}
          {dupIdCount > 1 && (
            <p
              className="hint"
              style={{ margin: "-4px 0 0", color: "var(--warn)" }}
            >
              {tr("ID「{id}」がこのページの{n}個の要素で重なっています。{変数}やアンカーが正しく動かないので、別々のIDにしてください。", {
                id: node.attrId ?? "",
                n: dupIdCount,
              })}
            </p>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => duplicateNodes(targetIds)}>
              <Icon name="copy" size={12} />
              {tr("複製")}
            </button>
            <button
              className={`btn btn-sm${node.locked ? " is-on" : ""}`}
              aria-pressed={!!node.locked}
              data-tip={
                node.locked
                  ? tr("ロックを解除して、キャンバス・レイヤーで動かしたり削除したりできるようにします")
                  : tr("キャンバス・レイヤーでの移動・リサイズ・削除をできなくします（スタイルは変えられます）")
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
              {node.locked ? tr("ロック中") : tr("ロック")}
            </button>
            <button
              className="btn btn-sm"
              style={{ color: "var(--danger)" }}
              disabled={!!node.locked}
              data-tip={node.locked ? tr("ロック中は削除できません") : undefined}
              onClick={() => deleteNodes(targetIds)}
            >
              <Icon name="trash" size={12} />
              {tr("削除")}
            </button>
          </div>
          {node.type === "box" && !inComponent && (
            <div style={{ display: "flex", gap: 6 }} data-tutorial="settings-make">
              <button
                className="btn btn-sm"
                data-tip={tr("複数のページで使い回せる部品にします（マスターを編集すると、すべての使用箇所に反映されます）")}
                onClick={() => createComponent(nodeId)}
              >
                <Component size={12} />
                {tr("コンポーネント化")}
              </button>
              <button
                className="btn btn-sm"
                data-tip={tr("このボックスをお手本にして、データの件数分くり返すリストにします")}
                onClick={() => createList(nodeId)}
              >
                <Icon name="list" size={12} />
                {tr("リスト化")}
              </button>
            </div>
          )}
        </div>
      </div>


      {node.type === "instance" && (
        <div className="sec" data-tutorial="settings-component">
          <div className="sec-head is-open">
            <span className="sec-title">
              {tr("コンポーネント ― {name}", { name: doc.components?.[node.componentId ?? ""]?.name ?? "?" })}
            </span>
            <InfoTip text={tr("コンポーネントのインスタンスです。中身を変えるにはマスターを編集します（すべての使用箇所に反映されます）。")} />
          </div>
          <div className="sec-body">
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-sm"
                onClick={() =>
                  node.componentId && setEditingComponent(node.componentId)
                }
              >
                {tr("マスターを編集")}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => detachInstance(nodeId)}
              >
                {tr("インスタンスを解除")}
              </button>
            </div>
          </div>
        </div>
      )}

      {node.type === "list" && node.list && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("リスト")}</span>
            <InfoTip
              text={tr("リストの1つ目がお手本のカードです。カードの中の文字で「{」を入力して項目を選ぶと、すべてのカードに反映されます。\n並べ替えや絞り込みは、スクリプトの「並べ替える」「絞り込む」で行います。")}
            />
          </div>
          <div className="sec-body">
            {(() => {
              const from = node.list.from ?? "";
              // 選べるのは、スクリプトで変数・配列に入れた一覧だけ
              //（取得したデータの中を自動で探した一覧は出さない）
              const arrays = pageArrays(doc, activePageId);
              // 入れ子のリストでは、外側のリストの項目が持つ一覧（各商品の tags など）も並べられる
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
                      ? tr("配列 · ページを開いてから値が決まる")
                      : Array.isArray(v)
                        ? tr("配列 · 見本{length}件", { length: v.length })
                        : tr("配列"),
                  };
                }),
                ...nested.map((c) => ({
                  value: c.path,
                  label: fieldLabel(c.path),
                  desc: tr("外側のリストの項目 · 見本{count}件", { count: c.count }),
                })),
              ];
              return (
                <>
                  <div className="row">
                    <label>{tr("並べる配列")}</label>
                    <Dropdown
                      value={from}
                      placeholder={tr("選択してください")}
                      options={[
                        ...options,
                        ...(from && !options.some((o) => o.value === from)
                          ? [
                              {
                                value: from,
                                label: tr("{p1}（配列になっていません）", { p1: fieldLabel(from) }),
                                desc: tr("スクリプトで変数に入れると選べるようになります"),
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
                        data-tip={tr("スクリプトでデータを変数に入れるか、文字列を分解して配列にすると、ここで選べるようになります")}
                        onClick={() => openScriptEditor({ focusNodeId: nodeId })}
                      >
                        {tr("スクリプトで配列を作る")}
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
                    <label>{tr("表示件数")}</label>
                    {/* 空欄 = すべて表示 */}
                    <input
                      key={`${nodeId}-limit-${node.list.limit ?? ""}`}
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={node.list.limit ?? ""}
                      placeholder={tr("すべて")}
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
            <span>{tr("意味付け（出力タグ）")}</span>
          </div>
          <div className="sec-body">
            <Dropdown
              value={node.semantic}
              options={SEMANTIC_OPTIONS.map((o) => ({
                value: o.value,
                label:
                  o.value !== "auto" && o.value !== "custom" ? tr("{label}（{value}）", { label: o.label, value: o.value }) : o.label,
                desc: o.desc,
                icon: SEMANTIC_ICONS[o.value],
              }))}
              onChange={(v) => updateNode(nodeId, { semantic: v as Semantic })}
            />
            {node.semantic === "custom" && (
              <div className="row" style={{ marginTop: 8 }}>
                <label>{tr("タグ名")}</label>
                <CommitInput
                  key={`${nodeId}-tag`}
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
              <p className="hint">{tr("空欄や使えないタグ名のときは div で出力します")}</p>
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
            <span className="sec-title">{tr("スクリプト")}</span>
            <InfoTip
              text={
                tr("「クリックしたとき」などのきっかけに、ページを開く・要素を表示するといった動作をつないで、要素に動きを付けられます。") +
                (node.link
                  ? tr("\n「クリックしたとき」にページやURLを開くだけのスクリプトは、リンク（a タグ）として出力されます。")
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
              {tr("ページのスクリプトを編集")}
            </button>
          </div>
        </div>
      )}

      {node.type === "image" && node.image && (
        <div className="sec" data-tutorial="settings-image">
          <div className="sec-head is-open">
            <span>{tr("画像")}</span>
          </div>
          <div className="sec-body">
            <div className="row">
              <label>URL</label>
              <VarInput
                key={`${nodeId}-src-${node.image.assetId ?? node.image.src}`}
                value={node.image.assetId ? "" : node.image.src}
                placeholder={
                  node.image.assetId
                    ? tr("（アセット画像）")
                    : tr("https:// または {変数}")
                }
                names={varNames}
                samples={varSamples}
                nodeId={nodeId}
                onCommit={(v) => {
                  const src = v.trim();
                  if (src)
                    updateNode(nodeId, {
                      image: { ...node.image!, src, assetId: undefined },
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
              {tr("アセットから選択")}
            </button>
            {assetPickerOpen && (
              <AssetGrid
                kind="image"
                selectedId={node.image?.assetId}
                onPick={(asset) => {
                  updateNode(nodeId, {
                    image: {
                      ...node.image!,
                      src: assetSrc(asset),
                      assetId: asset.id,
                      width: asset.width,
                      height: asset.height,
                    },
                  });
                  setAssetPickerOpen(false);
                }}
              />
            )}
            <div className="row">
              <label>{tr("代替テキスト")}</label>
              <CommitInput
                key={`${nodeId}-alt`}
                className="input"
                value={node.image.alt}
                placeholder={tr("画像の説明（必須）")}
                onCommit={(v) => updateNode(nodeId, { image: { ...node.image!, alt: v } })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            {!node.image.alt && (
              <p className="hint" style={{ margin: 0, color: "var(--warn)" }}>
                {tr("代替テキストが未設定です。公開前チェックで警告されます。")}
              </p>
            )}
            <label
              className="lbl"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="checkbox"
                checked={!!node.image.priority}
                onChange={(e) =>
                  updateNode(nodeId, {
                    image: { ...node.image!, priority: e.target.checked },
                  })
                }
              />
              {tr("優先して読み込む（最初に見える画像向け）")}
            </label>
            {node.image.assetId && doc.assets[node.image.assetId]?.svgFilter && (
              <label
                className="lbl"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <input
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
                {tr("iPhoneで影がぼやけるのを防ぐ（公開時に適用）")}
              </label>
            )}
            <p className="hint" style={{ margin: 0 }}>
              {tr("元のサイズ: {w} × {h}px", { w: node.image.width, h: node.image.height })}
            </p>
          </div>
        </div>
      )}

      {node.type === "icon" && node.icon && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("アイコン ― {name}", { name: node.icon.name })}</span>
            <InfoTip text={tr("色はスタイルの「テキスト → 色」、大きさは「サイズ」で調整できます。")} />
          </div>
          <div className="sec-body">
            <IconPicker
              value={node.icon.name}
              onSelect={(name, svg) =>
                updateNode(nodeId, { icon: { name, svg }, name: tr("アイコン {name}", { name }) })
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
            <span className="sec-title">{node.media.kind === "video" ? tr("動画") : tr("音声")}</span>
            <InfoTip text={tr("mp4・mp3などのファイルのURLを指定します。YouTubeは「YouTube」要素を使ってください。")} />
          </div>
          <div className="sec-body">
            <div className="row">
              <label>{tr("ファイルURL")}</label>
              <input
                key={`${nodeId}-msrc-${node.media.assetId ?? node.media.src}`}
                className="input"
                defaultValue={node.media.assetId ? "" : node.media.src}
                placeholder={
                  node.media.assetId
                    ? node.media.kind === "video"
                      ? tr("（アセットの動画）")
                      : tr("（アセットの音声）")
                    : node.media.kind === "video"
                    ? "https://…/movie.mp4"
                    : "https://…/sound.mp3"
                }
                onBlur={(e) =>
                  updateNode(nodeId, {
                    media: {
                      ...node.media!,
                      src: e.target.value.trim(),
                      assetId: undefined,
                    },
                  })
                }
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
              {tr("アセットから選択")}
            </button>
            {assetPickerOpen && (
              <AssetGrid
                kind={node.media.kind}
                selectedId={node.media?.assetId}
                emptyText={tr("対応するアセットがありません。左パネルの「アセット」から追加してください。")}
                onPick={(asset) => {
                  updateNode(nodeId, {
                    media: { ...node.media!, src: assetSrc(asset), assetId: asset.id },
                  });
                  setAssetPickerOpen(false);
                }}
              />
            )}
            <div className="stack" style={{ gap: 4 }}>
              {(
                [
                  ["loop", tr("くり返し再生")],
                  ["autoplay", tr("自動再生（ミュートされます）")],
                  ["muted", tr("ミュート")],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="lbl"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <input
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
                  map: tr("Googleマップ"),
                  url: tr("URL埋め込み"),
                }[node.embed.kind]
              }
            </span>
            {node.embed.kind === "url" && (
              <InfoTip text={tr("埋め込みを許可していないサイトは表示されないことがあります。")} />
            )}
          </div>
          <div className="sec-body">
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">
                {
                  {
                    youtube: tr("動画のURL"),
                    map: tr("住所・場所名・マップのURL"),
                    url: tr("埋め込むページのURL"),
                  }[node.embed.kind]
                }
              </label>
              <CommitInput
                key={`${nodeId}-esrc`}
                className="input"
                value={node.embed.src}
                placeholder={
                  {
                    youtube: "https://www.youtube.com/watch?v=…",
                    map: tr("例: 東京駅"),
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
                {tr("URLを読み取れませんでした。形式を確認してください。")}
              </p>
            )}
          </div>
        </div>
      )}

      {node.type === "code" && node.code && (
        <div className="sec">
          <div className="sec-head is-open">
            <span className="sec-title">{tr("カスタムコード（HTML）")}</span>
            <InfoTip text={tr("そのままHTMLとして埋め込まれます。")} />
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
  return (
    <label className="lbl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
        <span className="sec-title">{tr("フォーム部品")}</span>
        <InfoTip
          text={
            tr("上の「ID属性」が入力値の名前になります。{ID} と書くと、データの取得先URLなどに差し込めます。") +
            tr("\n初期値・案内文・表示テキストには {変数} を使えます。")
          }
        />
      </div>
      <div className="sec-body">
        {f.kind === "input" && (
          <div className="row">
            <label>type</label>
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
              <label>{tr("グループ")}</label>
              <CommitInput
                key={`${nodeId}-group-${f.group ?? ""}`}
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
                ? tr("同じグループのラジオボタンから1つだけ選べます。{{group}} が選んだボタンの値（表示テキスト）になります。", { group: f.group })
                : tr("同じグループ名のラジオボタンから1つだけ選べます。グループ名は、選んだボタンの値の変数名になります。")}
            </p>
          </div>
        )}
        {(f.kind === "checkbox" || f.kind === "radio") && (
          <>
            <div className="row">
              <label>{tr("表示テキスト")}</label>
              {varField("label", f.kind === "radio" ? tr("選んだときの値にもなります") : "")}
            </div>
            <CheckRow
              checked={!!f.checked}
              label={tr("最初からチェックしておく")}
              onChange={(v) => onChange({ checked: v || undefined })}
            />
          </>
        )}
        {(f.kind === "input" || f.kind === "textarea" || f.kind === "select") && (
          <div className="row">
            <label>{tr("初期値")}</label>
            {varField(
              "defaultValue",
              f.kind === "select"
                ? tr("選択肢と同じ文字を入力")
                : type === "color"
                  ? "#000000"
                  : ranged && rangePh
                    ? rangePh
                    : tr("最初から入力されている文字")
            )}
          </div>
        )}
        {(textual || type === "number" || (ranged && type !== "range")) && (
          <div className="row">
            <label>{tr("プレースホルダ")}</label>
            {varField("placeholder", tr("未入力時に薄く表示される文字"))}
          </div>
        )}
        {ranged && (
          <div className="grid3" style={{ gap: 6 }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("最小")}</label>
              {varField("min", type === "range" ? "0" : rangePh)}
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("最大")}</label>
              {varField("max", type === "range" ? "100" : rangePh)}
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("刻み")}</label>
              {varField("step", type === "range" || type === "number" ? "1" : "")}
            </div>
          </div>
        )}
        {textual && (
          <div className="row">
            <label>{tr("最大文字数")}</label>
            {num("maxLength", tr("制限なし"))}
          </div>
        )}
        {f.kind === "textarea" && (
          <div className="row">
            <label>{tr("行数")}</label>
            {num("rows", "2")}
          </div>
        )}
        {f.kind === "select" && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl">{tr("選択肢（1行に1つ）")}</label>
            <CommitTextarea
              key={`${nodeId}-opts`}
              className="textarea"
              rows={4}
              value={(f.options ?? []).join("\n")}
              onCommit={(v) =>
                onChange({
                  options: v
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        )}
        {f.kind === "file" && (
          <>
            <div className="row">
              <label>{tr("種類")}</label>
              <CommitInput
                key={`${nodeId}-accept-${f.accept ?? ""}`}
                className="input"
                value={f.accept ?? ""}
                placeholder={tr("例: image/*, .pdf（空 = すべて）")}
                onCommit={(v) => onChange({ accept: v.trim() || undefined })}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <CheckRow
              checked={!!f.multiple}
              label={tr("複数のファイルを選べる")}
              onChange={(v) => onChange({ multiple: v || undefined })}
            />
          </>
        )}
        <CheckRow
          checked={!!f.required}
          label={f.kind === "checkbox" ? tr("必須（チェックしないと送信できない）") : tr("必須（入力しないと送信できない）")}
          onChange={(v) => onChange({ required: v || undefined })}
        />
        <CheckRow
          checked={!!f.disabled}
          label={tr("無効にする（操作できない）")}
          onChange={(v) => onChange({ disabled: v || undefined })}
        />
        {!hasId && (
          <p className="hint" style={{ margin: 0, color: "var(--warn)" }}>
            {f.kind === "radio"
              ? tr("グループが未設定のため、この部品の値は送信されません。")
              : tr("ID属性が未設定のため、この部品の値は送信されません。")}
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
        <span className="sec-title">{tr("リンク")}</span>
        <InfoTip
          text={tr("押したときに開くURLやページです。スクリプト画面の「クリックしたとき → 開く」と同じもので、どちらで変えても同じになります。URLには {変数} や #ID（ページ内の位置）も使えます。")}
        />
      </div>
      <div className="sec-body">
        <Seg
          value={kind}
          options={[
            { value: "none", label: tr("なし") },
            { value: "url", label: "URL" },
            { value: "page", label: tr("ページ") },
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
            placeholder={tr("https://…・#ID・{変数}")}
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
              type="checkbox"
              checked={!!link.newTab}
              onChange={(e) => onChange({ ...link, newTab: e.target.checked || undefined })}
            />
            {tr("新しいタブで開く")}
          </label>
        )}
      </div>
    </div>
  );
}
