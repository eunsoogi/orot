import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const appRoot = resolve('apps/mobile');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const { transformSync } = appRequire('@babel/core');
const coreRoot = dirname(appRequire.resolve('@langchain/core/package.json'));
const configFile = resolve(appRoot, 'babel.config.js');

// Use Metro's default caller profile: Jest otherwise misses the message-branding constructor failure.
for (const dev of [true, false]) {
  test(`Metro message constructors preserve branding and content in ${dev ? 'Debug' : 'Release'}`, () => {
    for (const [file, name, fields, type] of [
      ['system', 'SystemMessage', { content: '{synthetic: system}' }, 'system'],
      ['human', 'HumanMessage', { content: '{synthetic: user}' }, 'human'],
      ['ai', 'AIMessage', { content: '{synthetic: assistant}' }, 'ai'],
      [
        'tool',
        'ToolMessage',
        { content: '{synthetic: tool}', tool_call_id: 'call_fixture' },
        'tool',
      ],
    ]) {
      const filename = resolve(coreRoot, `dist/messages/${file}.js`);
      const { code } = transformSync(readFileSync(filename, 'utf8'), {
        filename,
        cwd: appRoot,
        configFile,
        caller: { name: 'metro', platform: 'ios', unstable_transformProfile: 'default' },
        envName: dev ? 'development' : 'production',
      });
      const exports = {};
      runInNewContext(code, { exports, require: createRequire(filename) });
      const Message = exports[name];
      const message = new Message(fields);
      assert.equal(message.content, fields.content);
      assert.equal(message.type, type);
      assert.equal(Message.isInstance(message), true);
      assert.equal(message instanceof Message, true);
      assert.equal({} instanceof Message, false);
    }
  });
}
