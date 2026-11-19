import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const root = new URL("../skills/tsumu/", import.meta.url);
const relativeFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/minimal-site.json",
  "references/script-model/compose.ts",
  "references/site-doc.md",
  "references/types.ts",
];
const local = [];
const central = [];
let offset = 0;
for (const relative of relativeFiles) {
  const name = Buffer.from("tsumu/" + relative, "utf8");
  const raw = await readFile(new URL(relative, root));
  const compressed = deflateRawSync(raw, { level: 9 });
  const checksum = crc32(raw);
  if (name.length > 65535 || raw.length > 0xffffffff || compressed.length > 0xffffffff) {
    throw new Error("Skill package exceeds ZIP32 limits: " + relative);
  }
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);

  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x0800, 8);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt16LE(0x0021, 14);
  directory.writeUInt32LE(checksum, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(raw.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, name);
  offset += header.length + name.length + compressed.length;
}
const directoryData = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(relativeFiles.length, 8);
end.writeUInt16LE(relativeFiles.length, 10);
end.writeUInt32LE(directoryData.length, 12);
end.writeUInt32LE(offset, 16);
const output = resolve(process.argv[2] || "dist/tsumu-skill.zip");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([...local, directoryData, end]));
console.log("Wrote " + output);
