// PDF de exemplo (contrato fictício de 3 páginas, só texto) e os fatos que a nota precisa preservar.
const FACTS = ["2.500", "10 de novembro", "Marina Duarte", "Rua das Palmeiras", "30 dias", "12%"];
const PAGES = [
  ["CONTRATO DE LOCACAO RESIDENCIAL", "Locadora: Marina Duarte. Locatario: Pedro Almeida.", "Imovel: apartamento na Rua das Palmeiras, 410, Fortaleza."],
  ["CLAUSULA 2 - VALOR E PAGAMENTO", "O aluguel mensal e de R$ 2.500,00, com vencimento todo dia 10.", "Reajuste anual de 12% ou pelo indice IGP-M, o que for menor."],
  ["CLAUSULA 3 - PRAZO E RESCISAO", "O contrato inicia em 10 de novembro e vale por 30 meses.", "Aviso previo de rescisao: 30 dias, sob pena de multa proporcional."],
];
function makePdf() {
  const objs = [];
  const add = (s) => (objs.push(s), objs.length);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${PAGES.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${PAGES.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  PAGES.forEach((lines, i) => {
    const content = "BT /F1 14 Tf 60 740 Td 20 TL " + lines.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*`).join(" ") + " ET";
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
module.exports = { makePdf, FACTS };
