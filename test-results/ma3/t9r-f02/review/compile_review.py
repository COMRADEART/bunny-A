"""Compiles the independent-review record (rounds 1..N) into test-results/ma3/t9r-f02/independent-review.{json,md}.
Repairs/regressions per confirmed finding come from REPAIRS below (written by the implementer, checked against the tree)."""
import json, os, sys
SP = r'C:\Users\allam\AppData\Local\Temp\claude\C--Users-allam-Documents-new-bun-router\133abb7b-876a-4654-a1f2-ee186fd14586\scratchpad'
EV = r'C:\Users\allam\Documents\new\bun-router\test-results\ma3\t9r-f02'
REPAIRS = json.load(open(SP + r'\review\repairs.json', encoding='utf8'))
rounds = []
n = 1
while os.path.exists(SP + rf'\review\round{n}.json'):
    rounds.append((n, json.load(open(SP + rf'\review\round{n}.json', encoding='utf8'))))
    n += 1

def confirmed(f):
    votes = [v for v in (f.get('votes') or []) if v]
    if 'confirmed' in f: return bool(f['confirmed']), votes
    if not votes: return True, votes
    return sum(1 for v in votes if not v.get('refuted')) >= 1 and len([v for v in votes if not v.get('refuted')]) * 2 >= len(votes), votes

out = {'method': 'Each round: independent reviewer agents (one per lens) that did not write the change, with probes run in a scratch folder; every MEDIUM+ finding then went to two independent skeptic agents prompted to refute it. Confirmed = at least half the skeptics did not refute. Confirmed findings were repaired with a regression test before the next round, and each later round re-reviewed the earlier repairs.',
       'rounds': []}
md = ['# T9R-F02 independent security re-review', '', out['method'], '']
blockers_open = []
for n, data in rounds:
    rec = {'round': n, 'lenses': [x.get('lens') for x in data], 'findings': []}
    md += [f'## Round {n}', '', 'Lenses: ' + ', '.join(f'`{x.get("lens")}`' for x in data), '',
           '| # | Finding | Severity | Reproduction | Affected boundary | Repair | Regression test | Reviewer | Verdict |', '|---|---|---|---|---|---|---|---|---|']
    i = 0
    for lens in data:
        for f in lens.get('verified', []):
            i += 1
            ok, votes = confirmed(f)
            key = f'R{n}-{i}'
            rep = REPAIRS.get(f['title'], {})
            verdict = rep.get('verdict') or ('CONFIRMED' if ok else 'REFUTED')
            row = {'id': key, 'finding': f['title'], 'severity': f.get('severity'), 'reproduction': f.get('reproduction', ''), 'boundary': f.get('boundary', ''),
                   'repair': rep.get('repair', '—' if not ok else 'MISSING'), 'regression': rep.get('regression', '—'),
                   'reviewer': f'independent reviewer (lens {lens.get("lens")}) + {len(votes)} skeptics ({sum(1 for v in votes if v.get("refuted"))} refuted)',
                   'verdict': verdict, 'skepticVotes': [{'refuted': v.get('refuted'), 'severityIfReal': v.get('severityIfReal')} for v in votes]}
            rec['findings'].append(row)
            if f.get('severity') in ('BLOCKER', 'HIGH') and ok and not rep.get('repair'): blockers_open.append(key)
            if ok and not rep: print('NO REPAIR RECORD:', n, f['title'], file=sys.stderr)
            cell = lambda s: (s or '').replace('|', '\\|').replace('\n', ' ')[:420]
            md.append(f'| {key} | {cell(f["title"])} | {f.get("severity")} | {cell(f.get("reproduction"))} | {cell(f.get("boundary"))} | {cell(row["repair"])} | {cell(row["regression"])} | {cell(row["reviewer"])} | {verdict} |')
        for f in lens.get('low', []):
            rep = REPAIRS.get(f['title'], {})
            rec['findings'].append({'finding': f['title'], 'severity': 'LOW', 'reviewer': f'independent reviewer (lens {lens.get("lens")})', 'disposition': rep.get('repair', 'Accepted LOW (not verified by skeptics); see notes'), 'verdict': rep.get('verdict', 'LOW-ACCEPTED')})
    lows = [x for x in rec['findings'] if x['severity'] == 'LOW']
    md += ['', f'LOW findings this round ({len(lows)}):', '']
    for x in lows: md.append(f'- {x["finding"]} — **{x["verdict"]}**: {x["disposition"]}')
    md.append('')
    out['rounds'].append(rec)
allm = [f for r in out['rounds'] for f in r['findings'] if f['severity'] in ('BLOCKER', 'HIGH')]
out['summary'] = {'rounds': len(rounds), 'blockerOrHigh': len(allm), 'unresolvedBlockerOrHigh': blockers_open,
                  'mediumDispositions': [{'id': f['id'], 'finding': f['finding'], 'verdict': f['verdict']} for r in out['rounds'] for f in r['findings'] if f['severity'] == 'MEDIUM']}
json.dump(out, open(EV + r'\independent-review.json', 'w', encoding='utf8'), indent=2, ensure_ascii=False)
open(EV + r'\independent-review.md', 'w', encoding='utf8').write('\n'.join(md) + '\n')
print(json.dumps(out['summary'], ensure_ascii=False, indent=1))
