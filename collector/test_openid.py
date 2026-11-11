import io
import json
import tempfile
import unittest
from pathlib import Path
from email.message import Message
from urllib.error import HTTPError
from openid import Deferred, LIST, PoliteHTTP, collect, parse_listing

# Synthetic discovery fixture; real-site structural regressions are covered below.
HTML = '''<main><h2>Final Specifications</h2><ul>
<li><a href="/specs/openid-connect-core-1_0.html">OpenID Connect Core</a></li>
<li><a href="https://evil.example/specs/evil.html">Evil</a></li>
</ul><h2>Implementer’s Drafts</h2><table><tr><td>Unknown new protocol</td><td><a href="/specs/unknown-protocol-01.html#section">HTML</a></td></tr></table>
<a href="/specs/unknown-protocol-01.html">duplicate</a><a href="/developers/">Non-spec</a>
<a href="https://openid.net:443/specs/other.html">unexpected authority</a></main>'''


class Clock:
    def __init__(self): self.now = 1000000
    def time(self): return self.now
    def sleep(self, seconds): self.now += seconds


class Response(io.BytesIO):
    def __init__(self, body=b'', code=200, headers=None):
        super().__init__(body)
        self.code = code
        self.headers = Message()
        for key, value in (headers or {}).items(): self.headers[key] = value


class Opener:
    def __init__(self, clock, replies): self.clock, self.replies, self.calls = clock, list(replies), []
    def open(self, request, timeout):
        self.calls.append((self.clock.time(), request.full_url, dict(request.header_items())))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception): raise reply
        return reply


def client(replies):
    clock = Clock()
    opener = Opener(clock, replies)
    return PoliteHTTP(opener, clock.time, clock.sleep, lambda lo, hi: lo), opener, clock


class OpenIDTests(unittest.TestCase):
    def test_listing_discovers_unknown_names_stages_and_only_official_specs(self):
        rows = parse_listing(HTML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows['openid-connect-core-1_0']['stage'], 'Final')
        self.assertEqual(rows['unknown-protocol-01']['stage'], "Implementer's Draft")
        self.assertIn('Unknown new protocol', rows['unknown-protocol-01']['title'])
        self.assertNotIn('#', rows['unknown-protocol-01']['url'])
        self.assertEqual(parse_listing('<h2>Final</h2><a href="/specs/one.html">One</a><h2>Draft</h2><a href="/specs/two.html">Two</a>')['two']['stage'], 'Draft')
        with self.assertRaises(ValueError): parse_listing('<h1>Access denied</h1>')

    def test_real_listing_distinguishes_primary_editions_and_reference_links(self):
        rows=parse_listing((Path(__file__).parent/'fixtures/openid-listing.html').read_text())
        self.assertEqual(rows['openid-caep-specification-1_0']['stage'], "Implementer's Draft")
        self.assertEqual(rows['openid-caep-specification-1_0']['title'], 'OpenID Continuous Access Evaluation Profile 1.0')
        self.assertNotIn('openid-sse-framework-1_0-ID1', rows)
        self.assertEqual(rows['openid-caep-1_0-final']['stage'], 'Final')
        self.assertEqual(rows['openid-connect-self-issued-v2-1_0-ID1']['title'], 'Self-Issued OpenID Provider V2')
        self.assertEqual(rows['oauth-v2-grant-management-ID1']['title'], 'Grant Management for OAuth 2.0')
        self.assertEqual(rows['openid-connect-user-questioning-api-1_0-ID2']['title'], 'OpenID Connect User Questioning API')
        self.assertTrue(all(d['title'] != 'Implementer’s Draft' for d in rows.values()))

    def test_real_headings_scope_accordion_stages_and_plural_drafts(self):
        rows=parse_listing((Path(__file__).parent/'fixtures/openid-listing.html').read_text())
        self.assertEqual(rows['openid-authentication-2_0']['stage'], 'Final')
        self.assertEqual(rows['openid-simple-registration-extension-1_1-01']['stage'], 'Draft')
        self.assertEqual(rows['opaque-protocol-01']['stage'], 'Draft')
        self.assertEqual(rows['openid-ida-verified-claims-1_0-errata1']['stage'], 'Other')
        self.assertEqual(rows['openid-connect-token-bound-authentication-1_0']['url'], 'https://openid.net/specs/openid-connect-token-bound-authentication-1_0.html')

    def test_citations_do_not_create_specs_even_without_fragments_or_with_external_main(self):
        html='''<h2>Final Specifications</h2><ul>
        <li><a href="/specs/main-1_0.html">Main</a> Uses <a href="/specs/reference.html">Reference framework</a></li>
        <li><a href="https://example.com/editors-draft">External editor draft</a> references <a href="/specs/citation.html#section">Reference framework</a></li>
        <li><a href="https://example.com/other-editor-draft">Other protocol</a> – <a href="/specs/other-ID1.html">Implementer's Draft</a></li>
        </ul>'''
        rows=parse_listing(html)
        self.assertEqual(set(rows), {'main-1_0','other-ID1'})
        self.assertEqual(rows['other-ID1']['title'], 'Other protocol')
        self.assertEqual(rows['other-ID1']['stage'], "Implementer's Draft")

    def test_unrecognized_orphan_edition_keeps_identity_without_guessing_a_neighbor_title(self):
        rows=parse_listing('''<ul><li><a href="/specs/unrelated.html">Unrelated</a></li><li><a href="/specs/new-ID1.html">Implementer's Draft</a></li></ul>''')
        self.assertEqual(rows['new-ID1']['title'], 'new-ID1')
        self.assertEqual(rows['new-ID1']['stage'], "Implementer's Draft")

    def test_unknown_stage_clears_final_and_nested_headings_keep_parent_stage(self):
        rows=parse_listing('''<h2>Final Specifications</h2><p><a href="/specs/final.html">Final protocol</a></p><h2>Unclassified</h2><p><a href="/specs/unknown.html">Unknown protocol</a></p><h2>Drafts</h2><h3>New Working Group</h3><p><a href="/specs/draft.html">Protocol</a></p>''')
        self.assertEqual(rows['unknown']['stage'], 'Other')
        self.assertEqual(rows['draft']['stage'], 'Draft')

    def test_parser_upgrade_refreshes_listing_instead_of_reusing_stale_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'catalog/openid.json';path.parent.mkdir()
            path.write_text(json.dumps({'version':1,'documents':{},'listing':{'etag':'"old-parser"'}}))
            http,opener,_=client([Response(b''),Response(HTML.encode()),Response(b'body')])
            collect(root,http,limit=1)
            self.assertNotIn('If-none-match',opener.calls[1][2])
            self.assertEqual(json.loads(path.read_text())['listingParserVersion'],2)

    def test_pacing_start_jitter_robots_and_conditional_get(self):
        http, opener, _ = client([Response(b'User-agent: Terastack\nCrawl-delay: 12\n'), Response(HTML.encode(), headers={'ETag':'"index"'}), HTTPError(LIST, 304, '', Message(), io.BytesIO())])
        http.load_robots()
        http.get(LIST)
        self.assertEqual(http.get(LIST, {'etag':'"index"'}), (None, {}))
        self.assertEqual([row[0] for row in opener.calls], [1000030, 1000042, 1000054])
        self.assertEqual(opener.calls[-1][2]['If-none-match'], '"index"')

    def test_robots_disallow_blocks_before_request(self):
        http, opener, _ = client([Response(b'User-agent: *\nDisallow: /specs/\n')])
        http.load_robots()
        with self.assertRaises(ValueError): http.get('https://openid.net/specs/new.html')
        self.assertEqual(len(opener.calls), 1)

    def test_redirects_are_paced_and_cross_origin_is_rejected(self):
        http, opener, _ = client([Response(code=302, headers={'Location':'/specs/new.html'}), Response(b'new')])
        self.assertEqual(http.get(LIST)[0], b'new')
        self.assertGreaterEqual(opener.calls[1][0] - opener.calls[0][0], 5)
        http, opener, _ = client([Response(code=302, headers={'Location':'https://evil.example/'})])
        with self.assertRaises(ValueError): http.get(LIST)
        self.assertEqual(len(opener.calls), 1)

    def test_collection_is_bounded_rotates_and_retains_only_hashes(self):
        with tempfile.TemporaryDirectory() as root:
            http, _, _ = client([Response(b''), Response(HTML.encode(), headers={'ETag':'"list"'}), Response(b'content1', headers={'ETag':'"v1"'})])
            collect(root, http, limit=1)
            path = Path(root)/'catalog/openid.json'
            first = json.loads(path.read_text())
            self.assertEqual(sum('sha256' in doc for doc in first['documents'].values()), 1)
            self.assertNotIn('content1', path.read_text())
            http, opener, _ = client([Response(b''), Response(code=304), Response(b'content2')])
            collect(root, http, limit=1)
            second = json.loads(path.read_text())
            self.assertIn('unknown-protocol-01', opener.calls[-1][1])
            self.assertEqual(sum('sha256' in doc for doc in second['documents'].values()), 2)
            old_hash = second['documents']['unknown-protocol-01']['sha256']
            http, _, clock = client([Response(b''), Response(code=304), Response(b'changed'), Response(b'changed2')])
            clock.now += 86400
            collect(root, http, limit=2)
            third = json.loads(path.read_text())
            self.assertNotEqual(third['documents']['unknown-protocol-01']['sha256'], old_hash)

    def test_failure_does_not_advance_checkpoint_or_drop_documents(self):
        with tempfile.TemporaryDirectory() as root:
            http, _, _ = client([Response(b''), Response(HTML.encode()), Response(b'first'), Response(b'second')])
            collect(root, http)
            path = Path(root)/'catalog/openid.json'
            before = path.read_bytes()
            http, _, _ = client([Response(b''), Response(b'<h1>broken listing</h1>')])
            with self.assertRaises(ValueError): collect(root, http)
            self.assertEqual(path.read_bytes(), before)
            http, _, _ = client([Response(b''), Response(HTML.encode()), Response(code=500)])
            with self.assertRaises(ValueError): collect(root, http)
            self.assertEqual(path.read_bytes(), before)

    def test_retry_after_persists_and_prevents_next_run_access(self):
        with tempfile.TemporaryDirectory() as root:
            http, opener, _ = client([Response(code=429, headers={'Retry-After':'172800'})])
            with self.assertRaises(Deferred): collect(root, http)
            self.assertEqual(len(opener.calls), 1)
            state = json.loads((Path(root)/'catalog/openid.json').read_text())
            self.assertNotIn('lastSuccess', state)
            later, opener, _ = client([])
            with self.assertRaises(Deferred): collect(root, later)
            self.assertEqual(opener.calls, [])

    def test_retry_after_http_date_and_no_immediate_retries(self):
        from email.utils import formatdate
        http, opener, _ = client([Response(code=503, headers={'Retry-After':formatdate(1200000, usegmt=True)})])
        with self.assertRaises(Deferred) as error: http.get(LIST)
        self.assertEqual(error.exception.until, 1200000)
        self.assertEqual(len(opener.calls), 1)

    def test_body_304_retains_hash_and_missing_listing_removes_only_membership(self):
        html = '<h2>Drafts</h2><a href="/specs/a-01.html">A</a>'
        with tempfile.TemporaryDirectory() as root:
            http, _, _ = client([Response(b''),Response(html.encode(),headers={'ETag':'"list"'}),Response(b'body',headers={'ETag':'"body"'})])
            collect(root,http)
            path=Path(root)/'catalog/openid.json'
            before=json.loads(path.read_text())
            http, _, clock=client([Response(b''),Response(html.encode()),Response(code=304)])
            clock.now+=86400
            collect(root,http)
            after=json.loads(path.read_text())
            self.assertEqual(before['documents']['a-01']['sha256'],after['documents']['a-01']['sha256'])
            self.assertNotEqual(before['documents']['a-01']['checkedAt'],after['documents']['a-01']['checkedAt'])
            self.assertEqual(before['documents']['a-01']['changedAt'],after['documents']['a-01']['changedAt'])
            http, _, _=client([Response(b''),Response(html.replace('a-01','a-02').encode()),Response(b'next')])
            collect(root,http)
            after=json.loads(path.read_text())
            self.assertFalse(after['documents']['a-01']['listed'])
            self.assertIn('sha256',after['documents']['a-01'])
            self.assertTrue(after['documents']['a-02']['listed'])

    def test_request_and_body_caps_fail_without_more_requests(self):
        http, opener, _=client([Response(b'x'*(2*1024*1024+1))])
        with self.assertRaises(ValueError): http.get(LIST)
        http.requests=30
        with self.assertRaises(ValueError): http.get(LIST)
        self.assertEqual(len(opener.calls),1)
        http, _, _=client([Response(code=304)])
        with self.assertRaises(ValueError): http.get(LIST, {'title':'not a cached response'})


if __name__ == '__main__': unittest.main()

