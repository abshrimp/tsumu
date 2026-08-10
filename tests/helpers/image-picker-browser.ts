import { build } from "esbuild";
import { resolve } from "node:path";

export async function imagePickerBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ImagePicker, { AssetGrid } from "./components/ImagePicker";
import { useEditor } from "./lib/store";
const assets = Object.fromEntries(Array.from({length:5}, (_,i) => [String(i), {id:String(i), name:"photo"+i+".png", mimeType:"image/gif", dataUrl:"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}]));
useEditor.getState().updateDoc(d => { d.assets = assets; });
function Fixture() {
 const [target, setTarget] = useState("a");
 const [values, setValues] = useState({a:{url:"/same.png"},b:{url:"/same.png"}});
 return <>
 <button id="switch" onClick={() => setTarget(v => v==="a" ? "b" : "a")}>Switch</button>
 <button id="shrink" onClick={() => useEditor.getState().updateDoc(d => { delete d.assets["3"]; delete d.assets["4"]; })}>Shrink</button>
 <output id="values">{JSON.stringify(values)}</output><output id="target">{target}</output>
 <ImagePicker editTarget={target} value={values[target]} onChange={v => setValues(prev => ({...prev,[target]:v}))}/>
 <div id="grid"><AssetGrid kind="image" onPick={() => {}}/></div>
 </>;
}
createRoot(document.getElementById("app")).render(<Fixture/>);
`, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
