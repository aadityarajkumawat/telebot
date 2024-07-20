import { IS_PROD } from './consts';

export function Logger() {
    return {
        info: (message?: any, ...optionalParams: any[]) => {
            if (IS_PROD) return;
            console.log(`[INFO][${new Date().toString()}]: `, message, ...optionalParams);
        },

        error: (message?: any, ...optionalParams: any[]) => {
            if (IS_PROD) return;
            console.error(`[ERROR][${new Date().toString()}]: `, message, ...optionalParams);
        },

        warn: (message?: any, ...optionalParams: any[]) => {
            if (IS_PROD) return;
            console.warn(`[WARN][${new Date().toString()}]: `, message, ...optionalParams);
        }
    };
}
