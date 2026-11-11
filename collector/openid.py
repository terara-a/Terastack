"""OpenID official-list discovery; stdlib only, serial and deliberately paced."""
import copy
import hashlib
import json
import random
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

ORIGIN = 'https://openid.net'
LIST = ORIGIN + '/developers/specs/'
AGENT = 'Terastack/1.0 (+https://github.com/terara-a/Terastack; standards monitor)'
MAX_BODY = 2 * 1024 * 1024


def canonical(href):
    url = urlsplit(urljoin(LIST, href))
    if url.scheme != 'https' or url.netloc != 'openid.net' or not re.fullmatch(r'/specs/[A-Za-z0-9_.-]+\.html', url.path):
        return None
    return urlunsplit(('https', 'openid.net', url.path, '', ''))


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def text(self):
        return ' '.join(child.text() if isinstance(child, Node) else child for child in self.children)


class ListingParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in {'br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'wbr', 'embed', 'col', 'param', 'base'}:
            self.current = node

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                break
            node = node.parent

    def handle_data(self, value):
        if self.current.tag not in {'script', 'style'}:
            self.current.children.append(value)


def stage(text):
    if re.search(r'implement(?:er|or)[’\']?s?\s+draft', text, re.I):
        return "Implementer's Draft"
    if re.search(r'\bfinal\b', text, re.I):
        return 'Final'
    if re.search(r'\bdraft\b', text, re.I):
        return 'Draft'
    return 'Other'


def parse_listing(html):
    parser = ListingParser()
    parser.feed(html)
    result, heading = {}, ''

    def walk(node):
        nonlocal heading
        if node.tag in {'h1', 'h2', 'h3', 'h4', 'caption'}:
            heading = node.text()
        if node.tag == 'a':
            url = canonical(node.attrs.get('href', ''))
            if url:
                context = node.parent
                while context.parent and context.tag not in {'li', 'tr', 'p'}:
                    context = context.parent
                if context.tag not in {'li', 'tr', 'p'}:
                    context = node
                local = stage(context.text())
                publication = local if local != 'Other' else stage(heading)
                name = urlsplit(url).path.split('/')[-1][:-5]
                revision = re.search(r'(\d+[_.]\d+(?:-\d+)?(?:-errata\d+)?)(?:-|$)', name) or re.search(r'-(\d+)$', name)
                title = ' '.join(node.text().split())
                if title.lower() in {'html', 'spec', 'specification', 'read', 'link'}:
                    title = ' '.join(context.text().split())
                record = {'url': url, 'title': title[:500] or name, 'stage': publication, 'revision': revision.group(1) if revision else '', 'listed': True}
                if name not in result or result[name]['stage'] == 'Other':
                    result[name] = record
        for child in node.children:
            if isinstance(child, Node):
                walk(child)
    walk(parser.root)
    if not result:
        raise ValueError('No official specification links found; refusing an empty or changed listing')
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Deferred(Exception):
    def __init__(self, until):
        self.until = until
        super().__init__('OpenID collection deferred by server; no immediate retries')


class PoliteHTTP:
    def __init__(self, opener=None, clock=time.time, sleep=time.sleep, uniform=random.uniform):
        self.opener = opener or build_opener(NoRedirect())
        self.clock, self.sleep, self.uniform = clock, sleep, uniform
        self.last_end, self.minimum, self.requests, self.robots = None, 5, 0, None

    def wait(self, seconds):
        deadline = self.clock() + seconds
        while self.clock() < deadline:
            self.sleep(min(30, deadline - self.clock()))

    def get(self, url, cached=None, robots=False):
        for redirect in range(4):
            parts = urlsplit(url)
            if parts.scheme != 'https' or parts.netloc != 'openid.net' or parts.fragment or parts.query:
                raise ValueError('Unexpected OpenID request destination')
            if not (parts.path == '/robots.txt' or parts.path == '/developers/specs/' or canonical(url)):
                raise ValueError('Unexpected OpenID request path')
            if self.robots and not self.robots.can_fetch('Terastack', url):
                raise ValueError('OpenID robots.txt disallows this URL')
            if self.requests >= 30:
                raise ValueError('OpenID per-run request budget exceeded')
            delay = self.uniform(30, 180) if self.last_end is None else max(0, self.last_end + self.minimum + self.uniform(0, 5) - self.clock())
            self.wait(delay)
            headers = {'User-Agent': AGENT, 'Accept': 'text/html, text/plain;q=0.9'}
            if cached:
                for field, header in [('etag', 'If-None-Match'), ('lastModified', 'If-Modified-Since')]:
                    if cached.get(field):
                        headers[header] = cached[field]
            self.requests += 1
            try:
                response = self.opener.open(Request(url, headers=headers), timeout=30)
            except HTTPError as error:
                response = error
            finally:
                self.last_end = self.clock()
            with response:
                status, meta = response.code, response.headers
                if status in {429, 503}:
                    value = meta.get('Retry-After', '')
                    try:
                        until = self.clock() + int(value)
                    except ValueError:
                        try:
                            until = parsedate_to_datetime(value).timestamp()
                        except (ValueError, TypeError, OverflowError):
                            until = self.clock() + 86400
                    raise Deferred(max(self.clock() + 60, until))
                if status in {301, 302, 303, 307, 308}:
                    if redirect == 3:
                        raise ValueError('Too many OpenID redirects')
                    url, cached = urljoin(url, meta.get('Location', '')), None
                    continue
                if status == 304:
                    if not cached or not (cached.get('etag') or cached.get('lastModified')):
                        raise ValueError('Unexpected HTTP 304 without cached data')
                    return None, {}
                if status == 404 and robots:
                    return b'', {}
                if status != 200:
                    raise ValueError(f'OpenID HTTP {status}')
                body = response.read(MAX_BODY + 1)
                self.last_end = self.clock()
                if len(body) > MAX_BODY:
                    raise ValueError('OpenID response exceeds 2 MiB')
                return body, {field: meta[header] for field, header in [('etag', 'ETag'), ('lastModified', 'Last-Modified')] if meta.get(header)}
        raise ValueError('Unexpected redirect state')

    def load_robots(self):
        body, _ = self.get(ORIGIN + '/robots.txt', robots=True)
        self.robots = RobotFileParser()
        self.robots.parse(body.decode('utf-8', errors='replace').splitlines())
        rate = self.robots.request_rate('Terastack')
        self.minimum = max(5, self.robots.crawl_delay('Terastack') or 0, rate.seconds / rate.requests if rate else 0)


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def collect(root='.', http=None, limit=20):
    if not isinstance(limit, int) or not 1 <= limit <= 20:
        raise ValueError('OpenID body limit must be between 1 and 20')
    path = Path(root) / 'catalog/openid.json'
    previous = json.loads(path.read_text()) if path.exists() else {'version': 1, 'documents': {}, 'listing': {}}
    if previous.get('version') != 1 or not isinstance(previous.get('documents'), dict):
        raise ValueError('Invalid OpenID catalog')
    http = http or PoliteHTTP()
    if previous.get('notBefore', 0) > http.clock():
        raise Deferred(previous['notBefore'])
    state = copy.deepcopy(previous)

    def save(value):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
        temporary.replace(path)

    try:
        http.load_robots()
        body, headers = http.get(LIST, state.get('listing'))
        if body is not None:
            entries = parse_listing(body.decode('utf-8'))
            for doc in state['documents'].values():
                doc['listed'] = False
            for name, entry in entries.items():
                old = previous['documents'].get(name, {})
                metadata_changed = any(old.get(key) != value for key, value in entry.items())
                state['documents'][name] = {**old, **entry}
                if metadata_changed:
                    state['documents'][name]['changedAt'] = stamp(http.clock())
            state['listing'] = headers
        active = [(name, doc) for name, doc in state['documents'].items() if doc.get('listed')]
        # Unfetched documents first; oldest checked versions next. Daily bounded rotation.
        for name, doc in sorted(active, key=lambda item: (item[1].get('checkedAt', ''), item[0]))[:limit]:
            content, headers = http.get(doc['url'], doc)
            if content is not None:
                digest = hashlib.sha256(content).hexdigest()
                if digest != doc.get('sha256'):
                    doc['changedAt'] = stamp(http.clock())
                doc['sha256'] = digest
                doc.pop('etag', None)
                doc.pop('lastModified', None)
                doc.update(headers)
            doc['checkedAt'] = stamp(http.clock())
        state.pop('notBefore', None)
        state['lastSuccess'] = stamp(http.clock())
        save(state)
        print(f'OpenID: {len(active)} listed specifications; checked {min(limit, len(active))}; {http.requests} serial HTTP requests')
    except Deferred as error:
        # Persist the server cooldown across Actions runs without advancing the checkpoint.
        previous['notBefore'] = error.until
        save(previous)
        raise


if __name__ == '__main__':
    collect()
