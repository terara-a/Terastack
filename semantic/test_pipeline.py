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
    def test_fixture_has_fifty_cases_and_separate_splits(self):
        cases=json.loads((Path(__file__).parents[1]/'evaluation/semantic-cases.json').read_text())
        self.assertEqual(len(cases),74)
        self.assertEqual(len({c['name'] for c in cases}),74)
        self.assertEqual({c['split'] for c in cases},{'calibration','regression','test'})
        self.assertEqual(sum(c['expected'] for c in cases),37)
if __name__=='__main__': unittest.main()
