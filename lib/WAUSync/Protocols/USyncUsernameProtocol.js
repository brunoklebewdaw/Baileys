import { assertNodeErrorFree } from '../../WABinary';
import { USyncUser } from '../USyncUser';
export class USyncUsernameProtocol {
    constructor() {
        this.name = 'username';
    }
    getQueryElement() {
        return {
            tag: 'username',
            attrs: {}
        };
    }
    getUserElement(user) {
        void user;
        return null;
    }
    parser(node) {
        if (node.tag === 'username') {
            assertNodeErrorFree(node);
            return typeof node.content === 'string' ? node.content : null;
        }
        return null;
    }
}
//# sourceMappingURL=USyncUsernameProtocol.js.map