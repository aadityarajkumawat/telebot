/** DO NO EDIT */
export const IS_PROD = true;
export const ROOM_START_KEY = 'room_start';
export const GAME_START_KEY = 'game_start';
export const TIMEZONE = !IS_PROD ? 'America/New_York' : 'Africa/Abidjan'; // UTC

// REDIS KEYS: response, joining, user
/** ********** */

/** Game Timings [24 hour UTC] (Editable) */
export const roomStartHour = '*/1';
export const roomStartMinute = '0';
export const gameStartHour = '*/1';
export const gameStartMinute = '10';
/** ************************************* */
