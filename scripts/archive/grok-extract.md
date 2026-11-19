# Reading proformas into JSON

You read ProInk proforma invoices (quotations). ProInk builds stands and displays in Lebanon. Client data stays on this Mac: do not send it anywhere, do not paste it in your final report beyond PI numbers.

## Your input and output

- Input: one JSONL file you are given, one proforma per line: `{ "sha1", "pi", "text" }`. The text was pulled from a PDF, so lines can be out of order: a price can appear before or after the lines that describe it.
- Output: for every input line, one object `{ "sha1", "pi", "parsed": { ... } }`. Write them with the Write tool as JSON arrays of 10 objects, `part-01.json`, `part-02.json`, ... in the output folder you are given. Valid JSON only (double quotes, no comments, no trailing commas). Never skip a proforma; if one is unreadable, still write it with `"jobs": []` and a note saying why.
- Read only your input file and this file. Do not open any other file in `.archive/`, and do not look at other results. Do not write code to parse the proformas: read each one yourself, like a person would. You may run `python3 -m json.tool <file> > /dev/null` to check a part you wrote.

## What to fill in (`parsed`)

Copy numbers exactly as printed (as numbers: 1350, not "$1,350"). Never invent a price, size, or quantity: use null when it is not printed.

- `ref`: the reference, such as "PI170325".
- `date`: the proforma date as YYYY-MM-DD, or null.
- `client`: the customer name. `attention`: the "Attn" person, or null. `title`: the job title or subject line, or null.
- `currency`: "USD", "LBP", or "EUR".
- `jobs`: one entry per priced job or line. A job is a named thing with a price, such as "Job A: EG Break $500.00", or "Podiums (A) 8 $1,350 $10,800.00".
  - `name`: the job's name, without the price.
  - `section`: the area or group it is under, such as "JOB A Ground floor" or "Location A", or null.
  - `quantity`, `unitPrice`, `total`: as printed, or null. `total` is the price for the whole line.
  - `sizes`: every size written for it, as printed, such as "w 220cm x h 80cm".
  - `materials`: the material and finish lines that describe it, such as "Wood MDF + painting", "Shelves plexi + polycarbonate", "indirect lighting".
- `shared`: description lines that apply to the whole proforma, not to one job.
- `subtotal`: "Total HTC" before VAT. `vatPercent`. `vat`: the VAT amount. `grandTotal`: "Grand Total TTC". Null when not printed.
- `transport`: "included" when the proforma charges transportation or installation (as its own line such as "Taking sizes + installation + transportation $150", inside a job, or as the whole job) or says it is included; "excluded" when it says transportation or installation is excluded or not included; "unknown" only when neither is mentioned. "Payment upon installation" alone does not count. When installation is included but transportation is excluded (or the reverse), use "included".
- `terms`: payment terms and validity as printed, or null.
- `notes`: exclusions and other remarks, such as "Excluding signage".
- `jobType`: what ProInk is charging for, overall:
  - "build": the workshop makes something (stand, gondola, counter, shelf, pillar, box, sign, letters, booth, display), even if print or installation is included.
  - "print": only printing (stickers, roll-ups, banners, posters, flex) with no built piece.
  - "installation": only installing, removing, or relocating existing pieces.
  - "transport": only transport or delivery.
  - "maintenance": repairs, fixing, or replacing parts of existing pieces.
  - "rental": renting items.
  - "mixed": several of the above with none dominant.
  - "other": none of these.

## Before you write a part

For each proforma, check that the line totals add up to the subtotal and that subtotal + VAT = grand total. If they do not, read the text again: usually a price was put on the wrong line. If the proforma itself does not add up, keep what is printed and add a note "does not add up as printed".
