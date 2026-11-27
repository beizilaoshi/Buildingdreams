import {describe,it,expect} from 'vitest';
import {encodeInvite,decodeInvite,validateLinkConfig} from '../src/shared/link';
import {LinkService} from '../src/main/services/link';
describe('private network room',()=>{
 it('round trips private credentials and rejects tampered or excessive invitation data',()=>{const room={networkName:'zm-test',networkSecret:'secret-0123456789',peers:['tcp://example.com:11010']}; expect(decodeInvite(encodeInvite(room))).toEqual(room);expect(()=>decodeInvite('zm-link:invalid')).toThrow();expect(()=>decodeInvite('x'.repeat(10000))).toThrow();});
 it('rejects executable injection and unsupported peer URLs',()=>{expect(()=>validateLinkConfig({corePath:'cmd.exe',cliPath:'powershell.exe',peers:['file:///tmp']})).toThrow();});
 it('starts disconnected after restart and does not persist private room secrets',async()=>{const s=new LinkService('unused');expect((await s.state()).status).toBe('idle');expect((await s.state()).invite).toBeUndefined();await s.leave();});
});
