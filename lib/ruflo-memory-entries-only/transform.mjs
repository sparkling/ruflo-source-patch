const count = (s, n) => (n ? s.split(n).length - 1 : 0);
const splice = (s, a, b) => { const i = s.indexOf(a); return s.slice(0, i) + b + s.slice(i + a.length); };

export function makeSurface({ id, identity, edits }) {
  if (!id || !identity || !Array.isArray(edits) || !edits.length) throw new TypeError('surface needs id, identity, edits');
  for (const e of edits) {
    if (typeof e?.id !== 'string' || !e.old || !e.new || e.old === e.new || e.old.includes(e.new)) throw new TypeError(`bad edit ${e?.id}`);
    for (const o of edits) if (o !== e && e.new.includes(o.old)) throw new TypeError(`edit ${e.id} output contains anchor of ${o.id}`);
  }
  const state = (s, e) => count(s, e.new) === 1 && count(s, e.old) === count(e.new, e.old) ? 'new' : (count(s, e.old) === 1 && count(s, e.new) === 0 ? 'old' : 'bad');
  const owns = (s) => count(s, identity) === 1;
  const states = (s) => edits.map((e) => [e.id, state(s, e)]);
  const patched = (s) => owns(s) && states(s).every(([, v]) => v === 'new');
  const patch = (s) => {
    if (!owns(s)) return { next: s, applied: [], missing: [`${id}:identity`] };
    const st = states(s);
    const bad = st.filter(([, v]) => v === 'bad').map(([k]) => `${id}:${k}`);
    if (bad.length) return { next: s, applied: [], missing: bad };
    const todo = edits.filter((e) => st.find(([k]) => k === e.id)[1] === 'old');
    if (todo.length && todo.length !== edits.length) return { next: s, applied: [], missing: [`${id}:mixed-state`] };
    const next = todo.reduce((acc, e) => splice(acc, e.old, e.new), s);
    if (todo.length && !patched(next)) return { next: s, applied: [], missing: [`${id}:post-verify`] };
    return { next, applied: todo.map((e) => e.id), missing: [] };
  };
  const reverse = (s) => (patched(s) ? edits.reduceRight((acc, e) => splice(acc, e.new, e.old), s) : s);
  return { id, identity, patch, patched, reverse };
}

export function makeDescriptor({ name, surfaces, discover }) {
  const pick = (s) => { const m = surfaces.filter((x) => count(s, x.identity) === 1); return m.length === 1 ? m[0] : null; };
  const has = (s) => !!pick(s)?.patched(s);
  return {
    name, atomic: true, missingIsIncomplete: true, discover,
    patchSource: (s) => pick(s)?.patch(s) ?? { next: s, applied: [], missing: [`${name}:unrecognized-file`] },
    hasPatch: has, isPatched: has,
    reverse: (s) => pick(s)?.reverse(s) ?? s,
  };
}

// Keep rejected contributions only as reversible history, never as runtime code.
// The shared composer separately proves complete-file provenance against pristine.
export function withdrawDescriptor(legacy, native) {
  const historicalPatchSource = legacy.historicalPatchSource || legacy.patchSource;
  return { ...legacy, isPatched: native, historicalPatchSource,
    patchSource(source) {
      if (native(source)) return { next: source, applied: [], missing: [] };
      const restored = legacy.reverse(source);
      if (restored !== source && native(restored)
        && historicalPatchSource(restored, source).next === source)
        return { next: restored, applied: ['withdraw-downstream-adapter'], missing: [] };
      return { next: source, applied: [], missing: ['unrecognised-withdrawal-source'] };
    },
  };
}
