import json, sys

f1 = sys.argv[1]
d = json.load(open(f1, encoding='utf-8'))
out = []
for i in d['issues']:
    fl = i['fields']
    key = i['key']
    itype = (fl['issuetype']['name'] or '').lower()
    t = 'subtask' if ('subtask' in itype or itype == 'sub-task') else 'task'
    summ = fl.get('summary') or ''
    desc = fl.get('description') or ''
    if not isinstance(desc, str):
        desc = json.dumps(desc, ensure_ascii=False)
    text = (summ + '\n' + desc).strip()
    out.append({
        'type': t,
        'key': key,
        'id': i['id'],
        'author': (fl.get('creator') or {}).get('displayName'),
        'created': fl.get('created'),
        'url': 'https://ohmyjira.atlassian.net/browse/' + key,
        'text': text,
    })

json.dump(out, open(r'C:/Users/dzung/Workspace/Ohmyhotel/windows-schedule/sec-created.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('created items:', len(out))
