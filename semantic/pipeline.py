"""CPU-only semantic candidate discovery. No paid API and no keyword prefilter."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import time
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
API = 'https://datatracker.ietf.org'

def read(path, default):
    return json.loads(path.read_text()) if path.exists() else default

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    if path.name == 'semantic-index.json':
        rows = ',\n'.join(json.dumps(name)+':'+json.dumps(row,separators=(',',':')) for name,row in sorted(value['entries'].items()))
        encoded = '{\n"signature":'+json.dumps(value['signature'])+',\n"entries":{\n'+rows+'\n}\n}\n'
    else:
        encoded = json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n'
    temporary.write_text(encoded)
    temporary.replace(path)

def request(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Terastack semantic monitor'}), timeout=60) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def documents(kind, getter=request):
    url = f'{API}/api/v1/doc/document/?type={kind}&limit=100'
    seen = set()
    while url:
        if not url.startswith(API + '/api/') or url in seen:
            raise ValueError('Unsafe or repeated pagination URL')
        seen.add(url)
        page = getter(url)
        yield from page['objects']
        next_url = page['meta']['next']
        url = API + next_url if next_url and next_url.startswith('/') else next_url

def fingerprint(doc):
    return hashlib.sha256(json.dumps([doc['rev'],doc['time'],doc.get('title'),doc.get('abstract')], sort_keys=True).encode()).hexdigest()[:16]

def scores(model, docs, config):
    import numpy as np
    texts = [d['title'] + '\n' + d.get('abstract','') for d in docs]
    def normalized(items):
        vectors = np.array(list(model.embed(items)))
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
    positive, negative = normalized(config['positive']), normalized(config['negative'])
    vectors = normalized(texts)
    return (np.max(vectors @ positive.T, axis=1) - np.max(vectors @ negative.T, axis=1)).tolist()

def metrics(cases, values, threshold):
    tp = sum(c['expected'] and v >= threshold for c,v in zip(cases,values))
    fp = sum(not c['expected'] and v >= threshold for c,v in zip(cases,values))
    fn = sum(c['expected'] and v < threshold for c,v in zip(cases,values))
    return {'tp':tp,'fp':fp,'fn':fn,'recall':tp/max(1,tp+fn),'precision':tp/max(1,tp+fp),'selected':tp+fp,'total':len(cases)}

def identity(config, fixtures):
    return hashlib.sha256(json.dumps([config,fixtures],sort_keys=True).encode()).hexdigest()

def evaluate(model, config, fixtures, scorer=scores):
    values = scorer(model, fixtures, config)
    calibration = [(c,v) for c,v in zip(fixtures,values) if c['split']=='calibration']
    # Midpoint of calibration class boundaries when separable; held-out labels are never used.
    positive = sorted(v for c,v in calibration if c['expected'])
    if not positive:
        raise ValueError('No positive calibration cases')
    negative = [v for c,v in calibration if not c['expected']]
    if not negative:
        raise ValueError('No negative calibration cases')
    threshold = (positive[0]+max(negative))/2 if max(negative)<positive[0] else positive[0]-0.01
    heldout = [(c,v) for c,v in zip(fixtures,values) if c['split']=='test']
    measured = metrics([c for c,v in heldout],[v for c,v in heldout],threshold)
    regression=[(c,v) for c,v in zip(fixtures,values) if c['split']=='regression']
    return {'regressionMetrics':metrics([c for c,v in regression],[v for c,v in regression],threshold), 'signature':identity(config,fixtures),'model':config['model'],'threshold':threshold,'metrics':measured,
            'status':'passed' if measured['recall']>=0.90 and measured['precision']>=0.5 else 'failed',
            'scores':[{'name':c['name'],'split':c['split'],'expected':c['expected'],'score':round(v,6)} for c,v in zip(fixtures,values)]}

def process_batch(docs, model, config, threshold, progress, candidates, scorer=scores):
    for doc, score in zip(docs,scorer(model,docs,config)):
        name=doc['name']
        progress[name]=[fingerprint(doc),round(score,6),'' if name.startswith('rfc') else doc['rev'],'' if name.startswith('rfc') else doc['time']]
        if score >= threshold:
            candidates[name]={'rev':doc['rev'],'time':doc['time'],'title':doc['title'],'score':round(score,6),'reason':'埋め込みによる意味の近さから抽出。関連性は未確認。'}
        else:
            candidates.pop(name,None)

def priorities(index, entries, limit):
    missing=set(index)-set(entries)
    fresh=[name for name,row in index.items() if len(row)>5 and row[5] and (name in missing or entries[name][2:]!=row[:2])]
    fresh.sort(key=lambda name:index[name][5],reverse=True)
    tail=len(missing)<=2000
    names=list(dict.fromkeys(fresh+sorted(missing)))[:limit] if tail else fresh[:min(200,limit)]
    return names,tail

def run(mode, limit, root=ROOT):
    if limit <= 0:
        raise ValueError('Negative processing limit')
    from fastembed import TextEmbedding
    config=read(root/'semantic/config.json',{})
    fixtures=read(root/'evaluation/semantic-cases.json',[])
    model=TextEmbedding(model_name=config['model'],cache_dir=os.getenv('FASTEMBED_CACHE_PATH',str(root/'.cache/fastembed')),threads=2)
    at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    report=read(root/'reports/semantic/evaluation.json',{})
    if mode=='evaluate' or report.get('signature')!=identity(config,fixtures) or report.get('status')!='passed':
        started=time.monotonic()
        report=evaluate(model,config,fixtures)
        report.update(at=at,durationSeconds=round(time.monotonic()-started,2))
        save(root/'reports/semantic/evaluation.json',report)
        print(json.dumps(report['metrics']))
    if report['status']!='passed':
        raise ValueError('Held-out recall/precision gate failed; inspect semantic evaluation')
    if mode=='evaluate':
        return
    state=read(root/'catalog/semantic-index.json',{'signature':report['signature'],'entries':{}})
    candidates=read(root/'catalog/candidates.json',{})
    if state['signature']!=report['signature']:
        state={'signature':report['signature'],'entries':{}}
        candidates={}
    index=read(root/'catalog/state.json',{'index':{}})['index']
    # Stale revisions are removed immediately, even when this run reaches its limit.
    for name in list(candidates):
        if name not in index or (not name.startswith('rfc') and [candidates[name]['rev'],candidates[name]['time']]!=index[name][:2]):
            del candidates[name]
    processed=0
    batch=[]
    def checkpoint():
        save(root/'catalog/candidates.json',candidates)
        save(root/'catalog/semantic-index.json',state)
    # Read every document's metadata; no keyword/WG exclusion. Skip already-scored fingerprints.
    # Bound CPU work per run, checkpoint every 64 documents and resume next time.
    try:
        # Bulk pages can omit identities; finish the small remainder with exact-name lookups.
        names,tail=priorities(index,state['entries'],limit)
        for name in names:
            page=request(f'{API}/api/v1/doc/document/?name={urllib.parse.quote(name,safe="")}')
            doc=next((d for d in page['objects'] if d['name']==name),None)
            if doc is None:
                raise ValueError(f'Metadata not found for indexed document: {name}')
            batch.append(doc)
            if len(batch)>=64 or processed+len(batch)>=limit:
                process_batch(batch,model,config,report['threshold'],state['entries'],candidates)
                processed+=len(batch); batch=[]; checkpoint()
        if batch:
            process_batch(batch,model,config,report['threshold'],state['entries'],candidates)
            processed+=len(batch); batch=[]; checkpoint()
        for kind in ([] if tail else ['rfc','draft']):
            if processed>=limit:
                break
            for doc in documents(kind):
                if doc['name'] not in index:
                    continue
                previous=state['entries'].get(doc['name'])
                if previous and previous[0]==fingerprint(doc):
                    continue
                batch.append(doc)
                if len(batch)>=64 or processed+len(batch)>=limit:
                    process_batch(batch,model,config,report['threshold'],state['entries'],candidates)
                    processed+=len(batch); batch=[]; checkpoint()
                if processed>=limit:
                    break
            if processed>=limit:
                break
        if batch:
            process_batch(batch,model,config,report['threshold'],state['entries'],candidates)
            processed+=len(batch); checkpoint()
    finally:
        checkpoint()
        # Reproducible audit sample of low-scoring documents; never label them unrelated.
        low=sorted(name for name,row in state['entries'].items() if row[1]<report['threshold'])
        sample=random.Random(at[:10]).sample(low,min(20,len(low)))
        save(root/'reports/semantic/progress.json',{'at':at,'processed':processed,'screened':len(state['entries']),'total':len(index),'candidates':len(candidates),'lowScoreAuditSample':sample,'model':config['model']})
    print(f'Scored {processed}; screened {len(state["entries"])}/{len(index)}; candidates {len(candidates)}')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['evaluate','daily','backfill'],default='daily')
    parser.add_argument('--limit',type=int,default=2000)
    args=parser.parse_args()
    run(args.mode,args.limit)
