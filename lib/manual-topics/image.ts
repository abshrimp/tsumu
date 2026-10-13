import type { Topic } from "../manual";
import { tr } from "../i18n";

export const imageTopics: Topic[] = [  /* ================= 画像と動画 ================= */
  {
    id: "img-add",
    cat: "image",
    level: 1,
    q: tr("How do I add an image?"),
    a: tr("Upload images in the Assets tab, then click one or drag it onto the canvas. You can also drop image files from your computer straight onto the canvas."),
    keys: [tr("Image"), tr("photo"), tr("upload"), tr("Assets"), tr("drop"), tr("Paste")],
    ctx: ["none", "image"],
    body: [
      { p: tr("Click an asset while an image is selected to replace it. Images and SVGs copied from tools like Figma can be pasted with ⌘V.") },
      { rule: tr("Resize photos to under 2000px wide and 500KB each before uploading. Oversized images are the biggest cause of slow pages."), title: tr("Shrink images first") },
      { note: tr("You can store up to 25MB per file. Total storage is limited to 1GB on Cloudflare's free plan. Remove unused files all at once with \"Delete unused\".") },
    ],
    guide: [
      { target: "left-tab-assets", text: tr("Open the Assets tab."), done: (s) => s.leftTab === "assets" },
      { target: "asset-upload", text: tr("Click here or drop image files to upload."), prepare: { left: "assets" } },
      { target: "assets-panel", text: tr("Click an uploaded image to insert it at the selected spot, or drag it onto the canvas."), prepare: { left: "assets" } },
    ],
    see: ["img-fit", "img-alt", "d-images"],
  },
  {
    id: "img-fit",
    cat: "image",
    level: 2,
    q: tr("How do I make images the same size and shape (cropping)?"),
    a: tr("Select the image, choose an aspect ratio under Image in Style, and **set Fit to \"Fill frame\"**. Photos with different ratios end up the same shape."),
    keys: [tr("crop"), tr("trim"), tr("Aspect ratio"), tr("ratio"), "object-fit", tr("square"), tr("Thumbnail")],
    ctx: ["image"],
    body: [
      { fig: "object-fit", caption: tr("The same square photo in a wide frame") },
      { p: tr("Use \"Fill frame\" for photos and \"Show all\" for logos. Focal point chooses what to keep when cropping (toward the top for people).") },
      { rule: tr("Images in a row look tidy just by sharing an aspect ratio. Photos often use 4:3 or 16:9; products and icons, 1:1."), title: tr("Match ratios for images in a row") },
    ],
    guide: [
      { target: "style-image", text: tr("Choose the aspect ratio under Image and set Fit."), needs: "image", prepare: { right: "style", section: "style-image" } },
    ],
    see: ["img-add", "layout-grid"],
  },
  {
    id: "img-alt",
    cat: "image",
    level: 1,
    q: tr("What should I write in alt text?"),
    a: tr("**Describe in one sentence what the image conveys**, for people who can't see it. Enter it in Alt text under Settings in the right panel."),
    keys: ["alt", tr("Alt text"), tr("accessibility"), tr("screen reader")],
    ctx: ["image"],
    body: [
      { fig: "alt-text" },
      {
        table: {
          head: [tr("Image"), tr("Example alt text")],
          rows: [
            [tr("A photo of the shop"), tr("A bright interior with rows of wooden tables")],
            [tr("Logo"), tr("Sunny Café (just the site name)")],
            [tr("An image with text"), tr("The text in the image, as is")],
            [tr("Decorative lines or patterns"), tr("Can be left empty (it conveys nothing)")],
          ],
        },
      },
      { rule: tr("Avoid just writing \"image\" or \"photo\". Say what's in it and what it's meant to convey."), title: tr("Writing alt text") },
    ],
    guide: [
      { target: "settings-image", text: tr("Enter a description of the image in Alt text."), needs: "image", prepare: { right: "settings" } },
    ],
    see: ["d-accessibility", "img-add"],
  },
  {
    id: "img-media",
    cat: "image",
    level: 2,
    q: tr("How do I embed video, YouTube or maps?"),
    a: tr("Add Video, Audio, YouTube or Map from \"Media & embeds\" in the Add tab, then enter the URL or place under Settings in the right panel."),
    keys: [tr("Video"), "YouTube", tr("map"), tr("Map"), tr("embed"), tr("Audio"), "iframe"],
    ctx: ["media"],
    body: [
      { p: tr("For YouTube, just enter the video URL; for maps, an address or place name. Video and audio files can be chosen from Assets.") },
      { rule: tr("Autoplaying videos only play muted. If sound matters, let visitors press play themselves.") },
    ],
    guide: [{ target: "add-panel", text: tr("Choose what to add from \"Media & embeds\"."), prepare: { left: "add" } }],
  },
  {
    id: "img-icon",
    cat: "image",
    level: 1,
    q: tr("How do I use icons?"),
    a: tr("Add an Icon from the Add tab, then search and pick one under Settings in the right panel. Change its color with the text color and its size with Size."),
    keys: [tr("Icon"), tr("mark"), tr("symbol"), "icon"],
    body: [
      { p: tr("Set the color with Color under Text and the size with Size under Layout. For your own icons, upload an SVG to Assets and place it as an image.") },
      { rule: tr("Icons alone can be unclear. Add a short label to important actions.") },
    ],
    see: ["img-add"],
  },


];
