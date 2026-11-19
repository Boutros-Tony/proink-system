/**
 * How signs, headers, and shelf edges are built and priced, from the sign and shop-fitting trade:
 * the International Sign Association glossary, sign substrate guides (Sign Trade Supplies, Smart Signs),
 * event fabrication guides, and shelf-edge makers (VKF Renzel, HL Display, Harrison, kostklip).
 */
export function signageSection(): string {
  return `<signs-and-shelf-edges>
Signs and headers. First decide whether the sign is printed flat or has real depth.
- Printed flat: a print on the panel itself (vinyl or direct print on board, Foamex, Dibond, or acrylic), a stretched fabric graphic, or a backlit lightbox face. The panel is an element; the print is item:gfx-print by the m² of the printed face, plus item:gfx-lamination when it is laminated.
- 3D letters or logo, the ones that stand out from the surface ("embossed", "raised", "3D", "relief"):
  - Flat-cut: cut by router or laser from one sheet. Acrylic or Foamex 5 to 20 mm, MDF or wood 18 mm. One letters element with text set, depth the sheet thickness, materialId the sheet, plus item:lab-cnc for the cutting. The most common kind on a stand.
  - Stacked: two or more flat-cut layers glued for depth. One letters element per layer.
  - Built-up: hollow letters with a face and sides (returns) 50 to 100 mm deep, in acrylic or metal, usually lit. One letters element with depth the return, and the fabrication as suggestCosts per letter with match null, because there is no board count for it.
  - Push-through: acrylic letters set through a cut-out in a panel and lit from behind. The panel and the acrylic are elements, plus the lighting.
- Letters stood off the panel need item:hw-standoffs, about two per letter, or four per panel for a plaque.
- Lit signs. Face-lit: the front glows through an opal acrylic face. Halo-lit: light shines back onto the wall from letters stood 25 to 50 mm off it. Lightbox: a lit box with a printed face, item:ltg-lightbox by the m² of its face, plus its print. Every lit sign also gets its LEDs, a driver, and power by the lighting rule.
- Materials. Acrylic: premium, polished edges, the face of anything lit; brittle and scratches in transport. Foamex (foam PVC): cheap, light, prints well; soft edges and bows over long spans without a backing, so it suits one show. Dibond (aluminium composite): rigid, flat, and reusable; its plastic core shows on a raw edge. MDF or wood: a painted or natural look and good for stacked letters; MDF is sealed on every edge.
- Size on a stand. The header sits 2500 to 4000 mm high with letters at least 150 mm tall; the main logo is 600 mm or taller so it is seen over people standing at the stand.

Shelf edges. These are different pieces; name the right one.
- Data strip, also called a price rail or ticket strip: a clear plastic channel along the shelf front that holds a paper price ticket, usually 39 mm high, cut to the shelf length. Bought in 130 cm self-adhesive lengths: item:hw-data-strip, one for every 1.3 m of shelf front. It is not an element and not on the cutting plan. Self-adhesive on a fixed unit, clip-on only when it matches the shelf profile, magnetic on metal shelves.
- Aluminium price rail: the same channel in anodised aluminium, stronger and longer-lasting, screwed or stuck on: item:hw-alu-price-rail by the meter.
- Printed shelf strip: a printed band 40 to 80 mm high, cut to the rail length, slid into the data strip or stuck on: item:gfx-print by its area.
- Branded lip or front strip: a strip of board or acrylic on the shelf front, printed or with letters. It is cut, so it is an element on the shelf edge, by the shelf rule.
- Shelf talker: a rigid printed card or PVC panel, about A5, standing out from the shelf edge into the aisle: item:pos-shelf-talker each.
- Wobbler: a small printed card, 80 to 150 mm, on a flexible arm on the shelf edge: item:pos-wobbler each.
A shelf with paper prices that change often gets a data strip. A strip that carries the brand is a printed strip or a lip. Do not use one for the other.

When the sheet or the user makes it clear, decide. When it does not, ask with askUser and suggest the likely answer first, for example:
- the shelf front: data strip for paper prices / aluminium price rail / printed strip / plexi lip with print;
- the logo or header: printed on the panel / flat-cut 3D letters / built-up letters / lightbox;
- 3D letters: acrylic / Foamex / painted MDF / wood, and their thickness;
- whether the sign is lit: not lit / face-lit / halo-lit / lightbox.
</signs-and-shelf-edges>`;
}
