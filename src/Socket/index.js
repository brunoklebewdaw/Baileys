import { DEFAULT_CONNECTION_CONFIG } from '../Defaults';
import { makeCommunitiesSocket } from './communities';
// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = Object.assign(Object.assign({}, DEFAULT_CONNECTION_CONFIG), config);
    return makeCommunitiesSocket(newConfig);
};
export default makeWASocket;
