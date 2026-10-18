/**
 * English display text that differs from the English source key.
 *
 * Source keys are already English, so most strings need no entry here: tr("Save") shows "Save".
 * Add an entry only when the English display should differ from the key, for example:
 * - plural forms: "{n} pages" → "{n, plural, one {# page} other {# pages}}"
 * - the same English with different meanings: give each use its own key with a hint,
 *   such as tr("Done (tutorial step)"), and map it back here: "Done (tutorial step)" → "Done".
 *
 * Other languages also fall back to these entries when they have no translation of their own.
 */
import type { Dict } from "../i18n";

const en: Dict = {
  // AI
  "Validated {n} proposed edits": "Validated {n, plural, one {# proposed edit} other {# proposed edits}}",
  "{n} operations need correction": "{n, plural, one {# operation needs} other {# operations need}} correction",
  "Applied {n} changes": "Applied {n, plural, one {# change} other {# changes}}",

  // Search, comments and help
  "{n} matches": "{n, plural, one {# match} other {# matches}}",
  "{n} comments are on deleted pages. Switch to All pages to see them.":
    "{n, plural, one {# comment is on a deleted page. Switch to All pages to see it.} other {# comments are on deleted pages. Switch to All pages to see them.}}",
  "{n} steps": "{n, plural, one {# step} other {# steps}}",

  // Sites and pages
  "{n} sites": "{n, plural, one {# site} other {# sites}}",
  "{pages} pages · {nodes} elements":
    "{pages, plural, one {# page} other {# pages}} · {nodes, plural, one {# element} other {# elements}}",
  "Delete {n} pages?": "Delete {n, plural, one {# page} other {# pages}}?",
  "Loaded {name} and {length} assets": "Loaded {name} and {length, plural, one {# asset} other {# assets}}",
  "HTML converted into editable elements ({n} notices).":
    "HTML converted into editable elements ({n, plural, one {# notice} other {# notices}}).",
  "Styles and visibility settings for \"{label}\" on {used} elements will also be deleted (you can undo this).":
    "Styles and visibility settings for \"{label}\" on {used, plural, one {# element} other {# elements}} will also be deleted (you can undo this).",

  // Data and variables
  "{length} items": "{length, plural, one {# item} other {# items}}",
  "{length} fields": "{length, plural, one {# field} other {# fields}}",
  "List · {length} elements": "List · {length, plural, one {# element} other {# elements}}",
  "List · {length} items": "List · {length, plural, one {# item} other {# items}}",
  "List · {length} sample items": "List · {length, plural, one {# sample item} other {# sample items}}",
  "Outer list display item · {count} sample items":
    "Outer list display item · {count, plural, one {# sample item} other {# sample items}}",

  // Scripts
  "and {n} more actions": "and {n} more {n, plural, one {action} other {actions}}",
  "Wait {seconds} seconds": "Wait {seconds, plural, one {# second} other {# seconds}}",
  "Repeat {times} times…": "{times, plural, =1 {Repeat once…} other {Repeat # times…}}",

  // Assets and trash
  "{count} files could not be deleted.": "{count, plural, one {# file} other {# files}} could not be deleted.",
  "Delete {length} unused assets?": "Delete {length, plural, one {# unused asset} other {# unused assets}}?",
  "Used in {used} places. It will also be removed from the elements that use it. ":
    "Used in {used, plural, one {# place} other {# places}}. It will also be removed from the elements that use it. ",
  "All sites: {files} files stored on the server{p2}":
    "All sites: {files, plural, one {# file} other {# files}} stored on the server{p2}",
  "All sites: {length} assets stored on the server ({own} in this site){p2}":
    "All sites: {length, plural, one {# asset} other {# assets}} stored on the server ({own} in this site){p2}",
  "{count} deleted assets ({size}) remain on the server.":
    "{count, plural, one {# deleted asset ({size}) remains} other {# deleted assets ({size}) remain}} on the server.",
  "{count} of them ({size}) are scheduled for deletion and will be removed from the server {days} days after they were deleted.":
    "{count, plural, one {# of them ({size}) is scheduled for deletion and will be removed from the server {days, plural, one {# day} other {# days}} after it was deleted.} other {# of them ({size}) are scheduled for deletion and will be removed from the server {days, plural, one {# day} other {# days}} after they were deleted.}}",
  "Assets in trash are permanently deleted after {days} days unless restored.":
    "Assets in trash are permanently deleted after {days, plural, one {# day} other {# days}} unless restored.",
  "The server file moves to Trash and is permanently deleted after {days} days unless restored or used by another site.":
    "The server file moves to Trash and is permanently deleted after {days, plural, one {# day} other {# days}} unless restored or used by another site.",

  // Same English, different meaning: each key is the English text plus a hint in parentheses,
  // so other languages can translate each use differently.
  "Invalid request (request body)": "Invalid request",
  "Loading… (in progress)": "Loading…",
  "Reload (canvas)": "Reload",
  "Select parent (element)": "Select parent",
  "Back to list (comments)": "Back to list",
  "Paste (action)": "Paste",
  "Left panel (toggle)": "Left panel",
  "Right panel (toggle)": "Right panel",
  "Done (guide step)": "Done",
  "Done (tutorial step)": "Done",
  "Language (display)": "Language",
  "Help (menu)": "Help",
  "Selected box (help)": "Selected box",
  "Selected component (help)": "Selected component",
  "Steps (how-to)": "Steps",
  "About us (sample shop)": "About us",
  "Show all (fit)": "Show all",
  "Stretch (fit)": "Stretch",
  "Site settings (menu)": "Site settings",
  "Move up (in order)": "Move up",
  "Move down (in order)": "Move down",
  "text (field type)": "text",
  "color (field type)": "color",
  "List (data type)": "List",
  "Rows (count)": "Rows",
  "Set the URL to \"{slug}\" (tutorial)": "Set the URL to \"{slug}\"",
  "The parent decides the layout (tutorial)": "The parent decides the layout",
  "Add a box (tutorial)": "Add a box",
  "Add a button inside the box (tutorial)": "Add a button inside the box",
  "Set the margin to 16px left/right (tutorial)": "Set the margin to 16px left/right",
  "Set position back to Auto (tutorial)": "Set position back to Auto",
  "Open Settings in the right panel (tutorial)": "Open Settings in the right panel",
  "Text (element)": "Text",
  "End (finish tutorial)": "End",
  "Expand (contents)": "Expand",
  "Publish (page action)": "Publish",
  "New folder (choice)": "New folder",
  "Show (script action)": "Show",
  "Hide (script action)": "Hide",
  "Add (math)": "Add",
  "Multiply (math)": "Multiply",
  "Looks (block category)": "Looks",
  "Flow (block category)": "Flow",
  "data (variable name)": "data",
  "product (variable name)": "product",
  "products (variable name)": "products",
  "equal to (comparison)": "equal to",
  "not equal to (comparison)": "not equal to",
  "contain (comparison)": "contain",
  "not contain (comparison)": "not contain",
  "contain any of (comparison)": "contain any of",
  "contain none of (comparison)": "contain none of",
  "start with (comparison)": "start with",
  "not start with (comparison)": "not start with",
  "end with (comparison)": "end with",
  "not end with (comparison)": "not end with",
  "greater than (comparison)": "greater than",
  "not greater than (comparison)": "not greater than",
  "at least (comparison)": "at least",
  "not at least (comparison)": "not at least",
  "less than (comparison)": "less than",
  "not less than (comparison)": "not less than",
  "at most (comparison)": "at most",
  "not at most (comparison)": "not at most",
  "one of (comparison)": "one of",
  "not one of (comparison)": "not one of",
  "empty (comparison)": "empty",
  "not empty (comparison)": "not empty",
  "have an item (comparison)": "have an item",
  "not have an item (comparison)": "not have an item",
  "is (condition)": "is",
  "is not (condition)": "is not",
  "Select a field (target)": "Select a field",
  "Fit (image)": "Fit",
  "Transform (effect)": "Transform",
  "Move X (transform)": "Move X",
  "Move Y (transform)": "Move Y",
  "Input (field)": "Input",
  "None (resize)": "None",
  "Visible (overflow)": "Visible",
  "Hidden (overflow)": "Hidden",
  "Relative to (element)": "Relative to",
  "Heading 1 (text style)": "Heading 1",
  "Heading 2 (text style)": "Heading 2",
  "Heading 3 (text style)": "Heading 3",
  "LH (line height)": "LH",
  "LS (letter spacing)": "LS",
  "Input (element)": "Input",
  "Select (element)": "Select",
  "Navigation (element)": "Navigation",
  "link (help search)": "link",
  "test (help search)": "test",
  "When scrolled into view (help)": "When scrolled into view",
  "fetch data (help search)": "fetch data",
  "filter (help search)": "filter",
  "spacing (help search)": "spacing",
  "text (help search)": "text",
  "Good for (situations)": "Good for",
  "overlap (help search)": "overlap",
  "Meaning (element role)": "Meaning",
  "Checkbox (element)": "Checkbox",
  "restore (help search)": "restore",
  "export (help search)": "export",
  "Zoom in (animation)": "Zoom in",
  "Zoom out (animation)": "Zoom out",
  "Both (fill mode)": "Both",
  "None (fill mode)": "None",
  "Phone (landscape) (screen width)": "Phone (landscape)",
  "Landscape (short)": "Landscape",
  "Desktop (screen width)": "Desktop",
  "Show (visibility)": "Show",
  "Hide (visibility)": "Hide",
  "Supplementary info at the bottom of the page (tag description)": "Supplementary info at the bottom of the page",
  "Wrap (text option)": "Wrap",
  "None (no wrap)": "None",
};

export default en;
