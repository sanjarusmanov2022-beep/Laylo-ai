import assert from 'node:assert/strict';
import test from 'node:test';
import { assertExistingSurveyStorage, assertRetainedSurveyStorage } from '../scripts/update-live.mjs';

const binding = { name: 'SURVEYS', type: 'durable_object_namespace', class_name: 'SurveyStore', namespace_id: 'existing-namespace' };
const settings = extra => ({ bindings: [{ name: 'OTHER', type: 'plain_text' }, { ...binding }], ...extra });

test('Existing survey namespace is accepted when the settings API omits its migration tag', () => {
  for (const extra of [{}, { migration_tag: null }, { migration_tag: 'v1' }]) {
    assert.equal(assertExistingSurveyStorage(settings(extra)).namespace_id, binding.namespace_id);
  }
});
test('Missing, unknown, external or incomplete namespace settings stop before deployment', () => {
  for (const invalid of [
    {}, { bindings: [] },
    { ...binding, name: 'OTHER' }, { ...binding, type: 'plain_text' },
    { ...binding, class_name: 'OtherProject' }, { ...binding, namespace_id: undefined },
    { ...binding, namespace_id: '' }, { ...binding, namespace_id: ' ' },
    { ...binding, script_name: 'other-project' },
  ]) {
    const value = invalid.bindings || !invalid.name ? invalid : { bindings: [invalid] };
    assert.throws(() => assertExistingSurveyStorage(value));
  }
  assert.throws(() => assertExistingSurveyStorage(settings({ migration_tag: 'v2' })));
});
test('A verified namespace is retained with optional migration metadata and binding order changes', () => {
  for (const before of [settings({}), settings({ migration_tag: 'v1' })]) {
    const after = settings({}); after.bindings.reverse();
    assert.doesNotThrow(() => assertRetainedSurveyStorage(before, after));
  }
});
test('A changed or missing namespace is rejected after deployment', () => {
  for (const change of [
    { namespace_id: 'replacement-namespace' }, { namespace_id: undefined },
    { class_name: 'OtherClass' }, { script_name: 'other-project' },
  ]) {
    assert.throws(() => assertRetainedSurveyStorage(settings({}), { bindings: [{ ...binding, ...change }] }));
  }
  assert.throws(() => assertRetainedSurveyStorage(settings({}), { bindings: [] }));
});
