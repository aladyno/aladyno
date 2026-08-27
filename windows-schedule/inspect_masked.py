import json, re, sys

base = 'C:/Users/dzung/Workspace/Ohmyhotel/windows-schedule/'
items = json.load(open(base + 'sec-scan-input.json', encoding='utf-8'))

targets = sys.argv[1].split(',') if len(sys.argv) > 1 else []
kw = re.compile(r'(vendor_auth_key|aes_decrypt|aes_encrypt|credential|password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?key|bank_account|account_no|private key|decrypt key|encrypt key)', re.I)

# masking: hide UUIDs, long alnum tokens, long digit runs
uuid_re = re.compile(r'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b')
def mask_secrets(s):
    def m(mo):
        v = mo.group(0)
        return v[:4] + '…(' + str(len(v)) + ')'
    s = uuid_re.sub(m, s)
    # long alnum tokens (possible keys) 16+ chars
    s = re.sub(r'\b[0-9A-Za-z+/_=-]{16,}\b', m, s)
    # digit runs 6+ (account numbers)
    s = re.sub(r'\b\d{6,}\b', lambda mo: mo.group(0)[:2] + '…(' + str(len(mo.group(0))) + 'd)', s)
    return s

for it in items:
    if targets and it['key'] not in targets:
        continue
    text = it.get('text') or ''
    lines = text.split('\n')
    hits = [(n+1, ln) for n, ln in enumerate(lines) if kw.search(ln)]
    if not hits:
        continue
    print('=== %s [%s] author=%s created=%s ===' % (it['key'], it['type'], it.get('author'), it.get('created')))
    for n, ln in hits:
        print('  L%d: %s' % (n, mask_secrets(ln.strip())[:240]))
    print()
