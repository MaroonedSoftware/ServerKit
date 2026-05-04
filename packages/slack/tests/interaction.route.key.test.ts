import { describe, it, expect } from 'vitest';
import { interactionRouteKey } from '../src/slack.interaction.handler.js';

describe('interactionRouteKey', () => {
  it('keys block_actions by first action_id', () => {
    expect(interactionRouteKey({ type: 'block_actions', actions: [{ action_id: 'approve' }] })).toBe('block_actions:approve');
  });
  it('keys view_submission by view.callback_id', () => {
    expect(interactionRouteKey({ type: 'view_submission', view: { id: 'V1', callback_id: 'create_modal' } })).toBe('view_submission:create_modal');
  });
  it('keys view_closed by view.callback_id', () => {
    expect(interactionRouteKey({ type: 'view_closed', view: { id: 'V1', callback_id: 'create_modal' } })).toBe('view_closed:create_modal');
  });
  it('keys shortcut by callback_id', () => {
    expect(interactionRouteKey({ type: 'shortcut', callback_id: 'open_dialog' })).toBe('shortcut:open_dialog');
  });
  it('keys message_action by callback_id', () => {
    expect(interactionRouteKey({ type: 'message_action', callback_id: 'send_to_jira' })).toBe('message_action:send_to_jira');
  });
  it('returns undefined when block_actions has no actions', () => {
    expect(interactionRouteKey({ type: 'block_actions' })).toBeUndefined();
  });
  it('returns undefined when view_submission has no callback_id', () => {
    expect(interactionRouteKey({ type: 'view_submission' })).toBeUndefined();
  });
  it('falls back to type:callback_id for unknown types', () => {
    expect(interactionRouteKey({ type: 'workflow_step_edit', callback_id: 'cb1' })).toBe('workflow_step_edit:cb1');
  });
});
