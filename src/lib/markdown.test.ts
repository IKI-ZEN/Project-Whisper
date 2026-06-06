import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from './markdown.ts'
// The client renderer served to the browser. It must produce identical output
// to the server renderer above — this import lets us assert that in CI.
const { renderMarkdown: renderMarkdownClient } =
  await import('../../public/md.js') as { renderMarkdown: (s: string) => string }

describe('renderMarkdown — headings', () => {
  test('h1', () => {
    assert.equal(renderMarkdown('# Hello'), '<h1>Hello</h1>')
  })

  test('h2', () => {
    assert.equal(renderMarkdown('## Section'), '<h2>Section</h2>')
  })

  test('h3', () => {
    assert.equal(renderMarkdown('### Sub'), '<h3>Sub</h3>')
  })

  test('heading with inline bold', () => {
    assert.equal(renderMarkdown('## **Title**'), '<h2><strong>Title</strong></h2>')
  })
})

describe('renderMarkdown — inline markup', () => {
  test('bold **text**', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>')
  })

  test('bold __text__', () => {
    assert.equal(renderMarkdown('__bold__'), '<p><strong>bold</strong></p>')
  })

  test('italic *text*', () => {
    assert.equal(renderMarkdown('*italic*'), '<p><em>italic</em></p>')
  })

  test('italic _text_', () => {
    assert.equal(renderMarkdown('_italic_'), '<p><em>italic</em></p>')
  })

  test('bold+italic ***text***', () => {
    assert.equal(renderMarkdown('***bi***'), '<p><strong><em>bi</em></strong></p>')
  })

  test('bold+italic ___text___', () => {
    assert.equal(renderMarkdown('___bi___'), '<p><strong><em>bi</em></strong></p>')
  })

  test('inline code `code`', () => {
    assert.equal(renderMarkdown('`code`'), '<p><code>code</code></p>')
  })

  test('https link renders as <a>', () => {
    const out = renderMarkdown('[example](https://example.com)')
    assert.ok(out.includes('<a href="https://example.com"'))
    assert.ok(out.includes('rel="noopener noreferrer"'))
    assert.ok(out.includes('target="_blank"'))
    assert.ok(out.includes('>example</a>'))
  })

  test('http link also renders', () => {
    const out = renderMarkdown('[site](http://site.test)')
    assert.ok(out.includes('<a href="http://site.test"'))
  })

  test('non-http link is not rendered as anchor', () => {
    const out = renderMarkdown('[click](javascript:alert(1))')
    assert.ok(!out.includes('<a '))
  })
})

describe('renderMarkdown — HTML escaping', () => {
  test('& is escaped', () => {
    assert.ok(renderMarkdown('a & b').includes('a &amp; b'))
  })

  test('< is escaped', () => {
    assert.ok(renderMarkdown('a < b').includes('a &lt; b'))
  })

  test('" is escaped in heading text', () => {
    assert.ok(renderMarkdown('# say "hi"').includes('&quot;hi&quot;'))
  })

  test('raw HTML in input is escaped, not rendered', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    assert.ok(!out.includes('<script>'))
    assert.ok(out.includes('&lt;script&gt;'))
  })
})

describe('renderMarkdown — fenced code blocks', () => {
  test('code block with language tag', () => {
    const out = renderMarkdown('```js\nconsole.log(1)\n```')
    assert.ok(out.includes('<pre><code class="language-js">'))
    assert.ok(out.includes('console.log(1)'))
    assert.ok(out.includes('</code></pre>'))
  })

  test('code block without language tag', () => {
    const out = renderMarkdown('```\nhello\n```')
    assert.ok(out.includes('<pre><code>'))
    assert.ok(out.includes('hello'))
  })

  test('code block escapes HTML inside', () => {
    const out = renderMarkdown('```\n<b>bold</b>\n```')
    assert.ok(out.includes('&lt;b&gt;'))
    assert.ok(!out.includes('<b>'))
  })
})

describe('renderMarkdown — lists', () => {
  test('unordered list with -', () => {
    const out = renderMarkdown('- alpha\n- beta')
    assert.ok(out.includes('<ul>'))
    assert.ok(out.includes('<li>alpha</li>'))
    assert.ok(out.includes('<li>beta</li>'))
    assert.ok(out.includes('</ul>'))
  })

  test('unordered list with *', () => {
    const out = renderMarkdown('* one\n* two')
    assert.ok(out.includes('<ul>'))
    assert.ok(out.includes('<li>one</li>'))
    assert.ok(out.includes('<li>two</li>'))
  })

  test('ordered list', () => {
    const out = renderMarkdown('1. first\n2. second\n3. third')
    assert.ok(out.includes('<ol>'))
    assert.ok(out.includes('<li>first</li>'))
    assert.ok(out.includes('<li>second</li>'))
    assert.ok(out.includes('<li>third</li>'))
    assert.ok(out.includes('</ol>'))
  })
})

describe('renderMarkdown — blockquote', () => {
  test('renders as <blockquote>', () => {
    const out = renderMarkdown('> quoted text')
    assert.ok(out.includes('<blockquote>'))
    assert.ok(out.includes('quoted text'))
    assert.ok(out.includes('</blockquote>'))
  })
})

describe('renderMarkdown — horizontal rule', () => {
  test('--- renders as <hr>', () => {
    assert.equal(renderMarkdown('---'), '<hr>')
  })

  test('*** renders as <hr>', () => {
    assert.equal(renderMarkdown('***'), '<hr>')
  })

  test('___ renders as <hr>', () => {
    assert.equal(renderMarkdown('___'), '<hr>')
  })
})

describe('renderMarkdown — paragraph and empty input', () => {
  test('plain text becomes a paragraph', () => {
    assert.equal(renderMarkdown('hello world'), '<p>hello world</p>')
  })

  test('empty string produces empty output', () => {
    assert.equal(renderMarkdown(''), '')
  })

  test('whitespace-only line is preserved as empty', () => {
    const out = renderMarkdown('a\n\nb')
    assert.ok(out.includes('<p>a</p>'))
    assert.ok(out.includes('<p>b</p>'))
  })

  test('multi-line output joined with newline', () => {
    const out = renderMarkdown('# H\nparagraph')
    assert.equal(out, '<h1>H</h1>\n<p>paragraph</p>')
  })
})

describe('public/md.js stays identical to the server renderer', () => {
  // Every input the server renderer is tested against must produce identical
  // output from the client renderer, so the two can never silently diverge.
  const fixtures = [
    '# Hello', '## **Title**', '### Sub',
    '**bold**', '__bold__', '*italic*', '_italic_', '***bi***', '___bi___',
    '`code`', '[example](https://example.com)', '[click](javascript:alert(1))',
    'a & b', 'a < b', '# say "hi"', '<script>alert(1)</script>',
    '```js\nconsole.log(1)\n```', '```\nhello\n```', '```\n<b>bold</b>\n```',
    '- alpha\n- beta', '* one\n* two', '1. first\n2. second\n3. third',
    '> quoted text', '---', '***', '___',
    'hello world', '', 'a\n\nb', '# H\nparagraph',
  ]
  for (const input of fixtures) {
    test(`matches for ${JSON.stringify(input).slice(0, 40)}`, () => {
      assert.equal(renderMarkdownClient(input), renderMarkdown(input))
    })
  }
})
