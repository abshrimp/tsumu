import type { Topic } from "../manual";
import { tr } from "../i18n";

export const lookTopics: Topic[] = [  /* ================= 色と見た目 ================= */
  {
    id: "look-color",
    cat: "look",
    level: 1,
    q: tr("How do I change background or text colors?"),
    a: tr("For backgrounds, choose Color under Background in Style. For text, change Color under Text."),
    keys: [tr("Color"), tr("Background color"), tr("Text color"), tr("color"), tr("fill")],
    ctx: ["box", "text", "body"],
    body: [
      { p: tr("Pick from the swatch or type a code like #2563eb. The number on the right is opacity.") },
      { rule: tr("Limit yourself to base, main and accent colors, and keep strong contrast between text and background ([[d-color|choosing colors]])."), title: tr("Stick to three colors") },
    ],
    guide: [
      { target: "style-background", text: tr("Choose Color under Background and pick a color."), needs: "any", prepare: { right: "style", section: "style-background" } },
      { target: "style-typography", text: tr("Change text color with Color under Text."), prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-color", "look-bg-image"],
  },
  {
    id: "look-bg-image",
    cat: "look",
    level: 2,
    q: tr("How do I use an image or gradient as a background?"),
    a: tr("Choose Image or Gradient under Background. Pick an image from Assets or upload a new one."),
    keys: [tr("background image"), tr("Gradient"), tr("Background"), tr("photo"), tr("Cover")],
    ctx: ["box", "body"],
    body: [
      { p: tr("Set Size to Cover to fill the area without gaps, cropping the overflow. Position decides which part stays visible.") },
      { rule: tr("When putting text over a photo, give the text's box a semi-transparent black background. The text stays readable on any photo."), title: tr("Text over photos") },
      { note: tr("Put important info like dates and places in text, not baked into a background image. Search engines and screen readers can read it, and it's legible on phones.") },
    ],
    guide: [
      { target: "style-background", text: tr("Choose Image or Gradient under Background."), needs: "any", prepare: { right: "style", section: "style-background" } },
    ],
    see: ["look-color", "d-images"],
  },
  {
    id: "look-radius",
    cat: "look",
    level: 2,
    q: tr("How do I round corners or add a shadow?"),
    a: tr("For corners, use Corner radius under Appearance. For shadows, add a Drop shadow with \"+\" under Effects."),
    keys: [tr("rounded corners"), tr("round"), tr("Shadow"), tr("Shadow"), tr("Drop shadow"), tr("depth")],
    ctx: ["box", "image"],
    body: [
      { fig: "shadow" },
      { rule: tr("For a refined shadow, use a large blur and a light color (e.g. Y 4px, blur 16px, about 10% opacity). Keep corner radius and shadows consistent across the site."), title: tr("Shadows and corners") },
      { note: tr("For a circular image, make width and height equal and set a large corner radius (like 999px).") },
    ],
    guide: [
      { target: "style-appearance", text: tr("Enter a number for Corner radius under Appearance."), needs: "any", prepare: { right: "style", section: "style-appearance" } },
      { target: "style-effects", text: tr("Add shadows with \"+\" at the top right of Effects."), prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["d-consistency", "look-border"],
  },
  {
    id: "look-border",
    cat: "look",
    level: 1,
    q: tr("How do I add a border?"),
    a: tr("Enter a width under Border in Style to add one. You can choose a style (solid, dashed, etc.) and color too."),
    keys: [tr("border"), tr("Border"), tr("outline"), "border", tr("frame")],
    ctx: ["box", "image"],
    body: [
      { rule: tr("Separating with spacing or background color looks cleaner than adding lines. When you do use a line, a 1px light gray is the norm.") },
    ],
    guide: [
      { target: "style-border", text: tr("Enter a width under Border."), needs: "any", prepare: { right: "style", section: "style-border" } },
    ],
    see: ["look-radius", "d-hierarchy"],
  },
  {
    id: "look-hover",
    cat: "look",
    level: 2,
    q: tr("How do I change color on mouse-over (hover)?"),
    a: tr("**Switch State at the top of the right panel to Hover**, then change colors or other styles. Those settings apply only while the mouse is over the element."),
    keys: [tr("Hover"), tr("mouse-over"), tr("State"), tr("Pressed"), "hover", "active"],
    ctx: ["box", "text"],
    body: [
      { fig: "states" },
      { p: tr("Settings changed in a state apply only in that state. Switch back to Default when you're done. To smooth the color change, add \"On state change\" in [[look-animation|Motion]].") },
      { rule: tr("Phones have no hover. Don't hide information behind hover; limit it to a hint that something can be clicked."), title: tr("Don't rely on hover") },
    ],
    guide: [
      { target: "style-state", text: tr("Choose Hover under State."), needs: "any", prepare: { right: "style" }, done: (s) => s.styleState === "hover" },
      { target: "style-background", text: tr("Change the background color or other styles. These apply only on hover."), prepare: { right: "style", section: "style-background" } },
      { target: "preview", text: tr("Check it by hovering in Preview. Switch State back to Default when you're done.") },
    ],
    see: ["look-animation", "d-accessibility"],
  },
  {
    id: "look-animation",
    cat: "look",
    level: 3,
    q: tr("How do I make things fade in (animation)?"),
    a: tr("Add motion with \"+\" under Motion in Style, and set the trigger to \"When scrolled into view\" or \"Play on page load\"."),
    keys: [tr("animation"), tr("Motion"), tr("fade"), tr("Animation"), tr("Scroll"), tr("transition")],
    ctx: ["box", "text", "image"],
    body: [
      {
        table: {
          head: [tr("Triggers"), tr("When it plays")],
          rows: [
            [tr("On state change"), tr("When the look changes, e.g. on hover (smooths the change).")],
            [tr("Play on hover / Play on press"), tr("On mouse-over or press")],
            [tr("Play on page load"), tr("When the page opens")],
            [tr("When scrolled into view"), tr("When scrolled into view (once)")],
          ],
        },
      },
      { rule: tr("About 0.2–0.5 seconds feels right. Animate only key elements like headings and images."), title: tr("Keep motion short and sparse") },
    ],
    guide: [
      { target: "style-motion", text: tr("Add it with \"+\" at the top right of Motion, then choose the trigger and animation."), needs: "any", prepare: { right: "style", section: "style-motion" } },
      { target: "preview", text: tr("Check the motion in Preview.") },
    ],
    see: ["look-hover", "d-performance"],
  },
  {
    id: "look-effects",
    cat: "look",
    level: 3,
    q: tr("How do I add effects like transparency, frosted glass or black and white?"),
    a: tr("Use Opacity under Appearance for transparency, Background blur under Effects for frosted glass, and Grayscale for black and white."),
    keys: [tr("translucent"), tr("transparent"), tr("frosted glass"), tr("Blur"), tr("black and white"), tr("filter", "filter_variant_1"), tr("blend")],
    ctx: ["box", "image"],
    body: [
      { p: tr("Background blur blurs whatever is behind the element. Combined with a semi-transparent (60–80%) background color, it looks like frosted glass.") },
      { warn: tr("Adding blur or shadows to many elements can make things sluggish on phones.") },
    ],
    guide: [
      { target: "style-effects", text: tr("Set effects under Effects."), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
  },
  {
    id: "look-transform",
    cat: "look",
    level: 3,
    q: tr("I want to nudge, scale or skew an element (transform)"),
    a: tr("Add Transform with the + in Effects to set move, scale, rotate and skew, along with their origin. The layout around the element doesn't change."),
    keys: ["transform", tr("Transform", "transform_variant_1"), tr("Zoom in"), tr("Zoom out"), tr("Rotation"), tr("skew"), tr("Navigation"), tr("nudge")],
    ctx: ["box", "image"],
    body: [
      { p: tr("Set the state to Hover, set Scale to 105%, and add a “state change” motion to make a button or card that grows smoothly when the pointer is over it.") },
      { note: tr("A move in % is relative to the element's own size (-50% moves it left by half its width).") },
    ],
    guide: [
      { target: "style-effects", text: tr("Choose Transform from the + in Effects."), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["look-hover", "look-animation"],
  },
  {
    id: "form-fields",
    cat: "element",
    level: 2,
    q: tr("I want to set up inputs, checkboxes, switches and sliders"),
    a: tr("Select the field. Set its type, initial value, placeholder and whether it's required under Form field on the Settings tab, and colors such as the checkbox or slider color under Input on the Style tab."),
    keys: [tr("Input", "input_variant_2"), tr("Form"), tr("Checkbox", "checkbox_variant_1"), tr("Radio button"), tr("slider"), "input", "accent-color", tr("Default value"), tr("placeholder")],
    body: [
      { p: tr("The initial value, placeholder, label and options can contain {variables}, such as fetched data or the value of another field ({ID}).") },
      { p: tr("Number, slider and date fields have a minimum, maximum and step; text fields have a maximum length. A Required field can't be submitted empty.") },
      { p: tr("For checkboxes and switches, {ID} is true when checked and false when not. When a script's If compares it, you can pick On or Off.") },
      { p: tr("Radio buttons with the same Group allow only one choice. {group name} is the chosen button's value (its label), and {ID} is true or false depending on whether that button is chosen.") },
      { note: tr("Under Show advanced in Find a variable, you can also pick whether a field is disabled ({ID.disabled}), its length ({ID.length}) and the chosen number ({ID.index}). The script block “Set ［field］ to ［enabled / disabled］” switches whether it is disabled.") },
    ],
    see: ["act-vars", "data-search"],
  },
  {
    id: "look-custom-css",
    cat: "look",
    level: 4,
    q: tr("How do I write CSS that isn't in the panel?"),
    a: tr("Write it as `property: value;` in Custom CSS at the bottom of Style."),
    keys: ["CSS", tr("Custom CSS"), tr("Code"), "clip-path"],
    body: [
      { code: "clip-path: circle(50%);\nscroll-margin-top: 80px;" },
      { warn: tr("Custom CSS always applies, regardless of screen width or state. Use the panel for anything that should vary by screen width.") },
    ],
    guide: [
      { target: "style-css", text: tr("Write CSS here."), needs: "any", prepare: { right: "style", section: "style-css" } },
    ],
  },


];
