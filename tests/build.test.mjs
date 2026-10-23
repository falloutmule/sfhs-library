import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as html } from 'parse5';
import { parse as javascript } from 'acorn';
test('generated standalone executable remains valid JavaScript after literal source insertion',async()=>{
  const document=html(await readFile(new URL('../index.html',import.meta.url),'utf8'));
  const scripts=[];const external=[];
  function walk(node){if(node.tagName==='script'&&!node.attrs.some(a=>a.name==='type'))scripts.push(node.childNodes.map(n=>n.value||'').join(''));if(['script','link'].includes(node.tagName)&&node.attrs.some(a=>a.name==='src'&&/^https?:/.test(a.value)))external.push(node);for(const child of node.childNodes||[])walk(child);}
  walk(document);assert.equal(scripts.length,1);assert.equal(external.length,0);assert.doesNotThrow(()=>javascript(scripts[0],{ecmaVersion:'latest'}));
});
