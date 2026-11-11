import json
from pathlib import Path
import unittest
from pipeline import documents,evaluate,process_batch,fingerprint,identity
class PipelineTests(unittest.TestCase):
    def test_all_topic_pagination_and_origin(self):
        calls=[]
        def getter(url):
            calls.append(url)
            return {'objects':[{'name':'unknown-protocol'}], 'meta':{'next':'/api/next' if len(calls)==1 else None}}
        self.assertEqual(len(list(documents('draft',getter))),2)
        with self.assertRaises(ValueError):
            list(documents('draft',lambda _: {'objects':[],'meta':{'next':'https://evil.example/api/'}}))
    def test_heldout_labels_do_not_tune_threshold(self):
        config={'model':'fake'}
        cases=[{'name':'a','split':'calibration','expected':True},{'name':'n','split':'calibration','expected':False},{'name':'b','split':'test','expected':True},{'name':'c','split':'test','expected':False}]
        scorer=lambda *args:[0.4,-0.2,0.5,0.1]
        first=evaluate(None,config,cases,scorer)
        self.assertEqual(first['status'],'passed')
        cases[2]['expected']=False
        second=evaluate(None,config,cases,scorer)
        self.assertEqual(first['threshold'],second['threshold'])
        self.assertNotEqual(first['signature'],second['signature'])
    def test_low_scores_remain_scored_not_rejected_and_revision_is_reprocessed(self):
        progress={}; candidates={}
        doc={'name':'draft-new','rev':'00','time':'2026-11-11','title':'Unknown','abstract':'Access'}
        process_batch([doc],None,{},0.2,progress,candidates,lambda *args:[0.4])
        self.assertIn(doc['name'],candidates)
        first=progress[doc['name']][0]
        doc['rev']='01'
        process_batch([doc],None,{},0.2,progress,candidates,lambda *args:[0.1])
        self.assertNotIn(doc['name'],candidates)
        self.assertIn(doc['name'],progress)
        self.assertNotEqual(first,progress[doc['name']][0])
    def test_fixture_has_separate_calibration_regression_and_holdout_and_separate_splits(self):
        cases=json.loads((Path(__file__).parents[1]/'evaluation/semantic-cases.json').read_text())
        self.assertEqual(len(cases),74)
        self.assertEqual(len({c['name'] for c in cases}),74)
        self.assertEqual({c['split'] for c in cases},{'calibration','regression','test'})
        self.assertEqual(sum(c['expected'] for c in cases),37)
    def test_checkpoint_resumes_and_remote_failure_preserves_progress(self):
        import tempfile
        import types
        import sys
        from unittest.mock import patch
        import pipeline
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'semantic').mkdir(); (root/'evaluation').mkdir(); (root/'catalog').mkdir()
            config={'model':'fake','positive':[],'negative':[]}
            fixtures=[]
            pipeline.save(root/'semantic/config.json',config)
            pipeline.save(root/'evaluation/semantic-cases.json',fixtures)
            pipeline.save(root/'reports/semantic/evaluation.json',{'status':'passed','signature':identity(config,fixtures),'threshold':0.2})
            docs=[{'name':'draft-'+str(i),'rev':'00','time':'now','title':'Test','abstract':'Access'} for i in range(3)]
            pipeline.save(root/'catalog/state.json',{'index':{d['name']:['00','now',None] for d in docs}})
            original=pipeline.process_batch
            def batch(*args):
                return original(*args,scorer=lambda model,documents,config:[0.3]*len(documents))
            def getter(url):
                from urllib.parse import urlparse,parse_qs
                name=parse_qs(urlparse(url).query)['name'][0]
                return {'objects':[d for d in docs if d['name']==name]}
            def source(kind):
                return iter(docs) if kind=='rfc' else iter([])
            with patch.dict(sys.modules,{'fastembed':types.SimpleNamespace(TextEmbedding=lambda **kw:None)}),patch.object(pipeline,'request',getter),patch.object(pipeline,'documents',source),patch.object(pipeline,'process_batch',batch):
                pipeline.run('backfill',1,root)
                first=json.loads((root/'catalog/semantic-index.json').read_text())
                self.assertEqual(len(first['entries']),1)
                self.assertEqual(json.loads((root/'reports/semantic/progress.json').read_text())['remainingCount'],2)
                pipeline.run('backfill',1,root)
                second=json.loads((root/'catalog/semantic-index.json').read_text())
                self.assertEqual(len(second['entries']),2)
                def failed(url):
                    raise RuntimeError('API unavailable')
                with patch.object(pipeline,'request',failed):
                    with self.assertRaisesRegex(RuntimeError,'API unavailable'):
                        pipeline.run('backfill',64,root)
                preserved=json.loads((root/'catalog/semantic-index.json').read_text())
                self.assertEqual(second,preserved)
                with patch.object(pipeline,'request',lambda url: {'objects':[]}):
                    with self.assertRaisesRegex(ValueError,'Metadata not found'):
                        pipeline.run('backfill',64,root)
                self.assertEqual(json.loads((root/'reports/semantic/progress.json').read_text())['remainingCount'],1)
    def test_tail_completion_includes_old_missing_names_without_discovery_timestamp(self):
        from pipeline import priorities
        index={'rfc10':['','',None],'draft-old':['00','old',None],'draft-new':['01','new',None,'','','2026-11-11']}
        names,tail=priorities(index,{},2000)
        self.assertTrue(tail)
        self.assertEqual(set(names),set(index))
        self.assertEqual(names[0],'draft-new')
        names,tail=priorities(index,{name:['fp',0.1,*row[:2]] for name,row in index.items()},2000)
        self.assertEqual(names,[])
        self.assertTrue(tail)
    def test_zero_limit_is_rejected_before_loading_model(self):
        from pipeline import run
        with self.assertRaises(ValueError):
            run('backfill',0)
if __name__=='__main__': unittest.main()
