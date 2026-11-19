import json, glob, sys, re, collections
sys.path.insert(0, 'scripts/archive'); from structure import check
for b in sys.argv[1:]:
    inp = [json.loads(l) for l in open(f'.archive/grok/in/{b}.jsonl')]
    out = []
    for p in sorted(glob.glob(f'.archive/grok/out/{b}/part-*.json')):
        try: out += json.load(open(p))
        except Exception as e: print(b, 'BAD JSON', p, e)
    ins = {r['sha1'] for r in inp}; outs = {o.get('sha1') for o in out}
    bad = [o['pi'] for o in out if check(o.get('parsed') or {})]
    types = collections.Counter((o.get('parsed') or {}).get('jobType') for o in out)
    tr = collections.Counter((o.get('parsed') or {}).get('transport') for o in out)
    print(b, f'in {len(inp)} out {len(out)} missing {len(ins-outs)} extra {len(outs-ins)} problems {len(bad)} {bad[:8]}', dict(types), dict(tr))
