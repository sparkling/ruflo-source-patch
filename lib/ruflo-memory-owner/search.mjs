// Preserve native BM25/semantic calculations and their order. Only yield between
// documents, after the native SELECT has finished and holds no active cursor.
const marker = 'ruflo-source-patch (ruflo#4654): cooperative native search';
const yieldStep = `        if (Date.now() - rspSearchYieldAt >= 8) {
            await new Promise(resolve => setTimeout(resolve, 0));
            rspSearchYieldAt = Date.now();
        }`;
export const searchEdits = [
  [`function tokenizeCorpus(rows) {
    return rows.map(row => {
        const contentLower = (row.content || '').toLowerCase();
        return { contentLower, words: contentLower.split(/\\s+/) };
    });
}`, `// ${marker}: tokenize each selected row exactly once.
async function tokenizeCorpus(rows) {
    const docs = []; let rspSearchYieldAt = Date.now();
    for (const row of rows) {
${yieldStep}
        const contentLower = (row.content || '').toLowerCase();
        docs.push({ contentLower, words: contentLower.split(/\\s+/) });
    }
    return docs;
}`],
  [`function computeTermDocFreqs(queryTerms, docs) {
    const termDocFreqs = new Map();
    let totalLength = 0;
    for (const doc of docs) {`, `// ${marker}: retain native term counts and accumulation order.
async function computeTermDocFreqs(queryTerms, docs) {
    const termDocFreqs = new Map();
    let totalLength = 0, rspSearchYieldAt = Date.now();
    for (const doc of docs) {
${yieldStep}`],
  ['const docs = tokenizeCorpus(rows);', 'const docs = await tokenizeCorpus(rows);'],
  ['const { termDocFreqs, avgDocLength } = computeTermDocFreqs(queryTerms, docs);',
    'const { termDocFreqs, avgDocLength } = await computeTermDocFreqs(queryTerms, docs);'],
  [`        const results = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const doc = docs[i];`, `        const results = [];
        let rspSearchYieldAt = Date.now();
        for (let i = 0; i < rows.length; i++) {
            // ${marker}: scores, thresholds and ranking remain native.
${yieldStep.replaceAll('\n', '\n    ')}
            const row = rows[i];
            const doc = docs[i];`],
];
