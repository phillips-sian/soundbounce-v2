// This redux module is shared between client and server,
// so the same messages (shared via socket.io) can keep state in sync
import update from 'react-addons-update';
import config from '../../../../config/app';
import moment from 'moment';
import {SOCKET_ROOM_STATS_OK} from '../socket';

// ------------------------------------
// Constants
// ------------------------------------
export const ROOM_FULL_SYNC = 'ROOM_FULL_SYNC';
export const ROOM_USER_JOIN = 'ROOM_USER_JOIN';
export const ROOM_USER_LEAVE = 'ROOM_USER_LEAVE';
export const ROOM_TRACK_ADD_OR_VOTE = 'ROOM_TRACKS_ADD_OR_VOTE';
export const ROOM_TRACK_VOTE_SKIP = 'ROOM_TRACK_VOTE_SKIP';
export const ROOM_NOW_PLAYING_CHANGED = 'ROOM_NOW_PLAYING_CHANGED';
export const ROOM_NOW_PLAYING_ENDED = 'ROOM_NOW_PLAYING_ENDED';
export const ROOM_TRACK_LIKE = 'ROOM_TRACK_LIKE';
export const ROOM_CHAT = 'ROOM_CHAT';
export const ROOM_REACTION = 'ROOM_REACTION';
export const ROOM_EMOJI_ANIMATION = 'ROOM_EMOJI_ANIMATION';
export const ROOM_TRACK_PROGRESS = 'ROOM_TRACK_PROGRESS';
export const ROOM_NAVIGATING = 'ROOM_NAVIGATING';

export const actions = {
	ROOM_FULL_SYNC,
	ROOM_USER_JOIN,
	ROOM_USER_LEAVE,
	ROOM_NOW_PLAYING_CHANGED,
	ROOM_NOW_PLAYING_ENDED,
	ROOM_TRACK_ADD_OR_VOTE,
	ROOM_TRACK_VOTE_SKIP,
	ROOM_TRACK_LIKE,
	ROOM_CHAT,
	ROOM_REACTION,
	ROOM_EMOJI_ANIMATION,
	ROOM_TRACK_PROGRESS,
	ROOM_NAVIGATING
};

// ------------------------------------
// Default state
// ------------------------------------
const defaultState = {
	id: null,
	name: '????',
	config: {},
	actionLog: [],
	listeners: [],
	playlist: [],
	recentlyPlayed: [],
	nowPlayingStartedAt: null,
	nowPlayingProgress: null
};

// ------------------------------------
// Action Creators
// ------------------------------------
export const roomFullSync = (fullSync) => ({
	type: ROOM_FULL_SYNC,
	payload: {fullSync}
});

export const roomUserJoin = (userId) => ({
	type: ROOM_USER_JOIN,
	payload: {userId}
});

export const roomUserLeave = (userId) => ({
	type: ROOM_USER_LEAVE,
	payload: {userId}
});

export const roomTrackAddOrVote = ({userId, trackIds, reason = '', isAdd}) => ({
	type: ROOM_TRACK_ADD_OR_VOTE,
	payload: {userId, trackIds, reason, isAdd}
});

export const roomTrackVoteSkip = ({userId, trackIds, moment}) => ({
	type: ROOM_TRACK_VOTE_SKIP,
	payload: {userId, trackIds, moment}
});

export const roomChat = ({userId, text, trackIds, offset}) => ({
	type: ROOM_CHAT,
	payload: {userId, text, trackIds, offset}
});

export const roomReaction = ({userId, emoji, trackIds, offset}) => ({
	type: ROOM_REACTION,
	payload: {userId, emoji, trackIds, offset}
});

export const roomEmojiAnimation = ({emojiId, animation}) => ({
	type: ROOM_EMOJI_ANIMATION,
	payload: {emojiId, animation}
});

export const roomNowPlayingChanged = ({trackIds, seekPosition}) => ({
	type: ROOM_NOW_PLAYING_CHANGED,
	payload: {trackIds, seekPosition}
});

export const roomNowPlayingEnded = ({trackWithVotes, finishingTrackDuration}) => ({
	type: ROOM_NOW_PLAYING_ENDED,
	payload: {trackWithVotes, finishingTrackDuration}
});

export const roomTrackProgress = ({nowPlayingProgress}) => ({
	type: ROOM_TRACK_PROGRESS,
	payload: {nowPlayingProgress}
});

export const roomNavigating = (roomId) => ({
	type: ROOM_NAVIGATING,
	payload: {roomId}
});

// ------------------------------------
// Action Handlers
// ------------------------------------
const appendToActionLog = ({actionLog, action}) => {
	const messagesToRemove = actionLog.length - config.playlist.actionLogMaxLength;
	if (messagesToRemove > 0) {
		// remove old messages if at limit
		const croppedLog = update(actionLog, {$splice: [[0, messagesToRemove]]});
		return update(croppedLog, {$push: [action]});
	}
	return update(actionLog, {$push: [action]});
};

const applyVotes = ({playlist, payload}) => {
	const {userId, trackIds, reason, emote} = payload;
	/*
	 The playlist is an array of track ids with votes, like so:
	 [{id, votes: [{userId, emote, reason}], skipVotes: [{userId}...]} ,...]
	 */
	let updatedPlaylist = playlist;
	for (let trackId of trackIds) {
		let playlistTrack = updatedPlaylist.find(t => t.id === trackId);
		if (!playlistTrack) {
			playlistTrack = {id: trackId, votes: [], skipVotes: []};
		} else {
			const oldIndex = updatedPlaylist.indexOf(playlistTrack);

			// can't vote for the now playing track
			if (oldIndex === 0) {
				continue;
			}

			// track was already in list - check they haven't already voted for it
			if (playlistTrack.votes.find(v => v.userId === userId)) {
				// user has already voted, neeeext!
				continue;
			}
			// remove the existing track from the playlist
			updatedPlaylist = update(updatedPlaylist, {$splice: [[oldIndex, 1]]});
		}

		// add the vote to the track if there's a userId
		// if no userId, it was added by soundbounce itself (refill)
		const newPlaylistTrack = userId ? update(playlistTrack, {
			votes: {$push: [{userId, emote, reason}]}
		}) : playlistTrack;

		// if this is the only track or first track, just return it as only item
		if (updatedPlaylist.length === 0) {
			updatedPlaylist = [newPlaylistTrack];
			continue;
		}

		if (updatedPlaylist.length === 1) {
			// there is a track playing which we shouldn't touch
			updatedPlaylist = [updatedPlaylist[0], newPlaylistTrack];
			continue;
		}

		// start from the bottom of the playlist, stopping before a track with our
		// vote count
		let playlistIndex = updatedPlaylist.length;
		while (playlistIndex > 1) {
			if (updatedPlaylist[playlistIndex - 1].votes.length >= newPlaylistTrack.votes.length) {
				break;
			}
			playlistIndex--;
		}
		// insert at the new spot
		updatedPlaylist = update(updatedPlaylist, {$splice: [[playlistIndex, 0, newPlaylistTrack]]});
	}

	return updatedPlaylist;
};

const applySkipVote = ({playlist, payload}) => {
	const {userId, trackIds} = payload;
	let updatedPlaylist = [...playlist];

	for (let trackId of trackIds) {
		let playlistTrack = updatedPlaylist.find(t => t.id === trackId);
		if (!playlistTrack) {
			// can't skip a track that isn't in list
			continue;
		}
		const playlistIndex = updatedPlaylist.indexOf(playlistTrack);

		// track was already in list - check they haven't already voted for it
		if (playlistTrack.skipVotes && playlistTrack.skipVotes.find(v => v.userId === userId)) {
			// user has already voted to skip, neeeext!
			continue;
		}

		// if they had an upvote for this track, remove it
		playlistTrack.votes = [...playlistTrack.votes].filter(v => v.userId !== userId);

		let updatedPlaylistTrack = {...playlistTrack};
		// old tracks might not have this yet
		if (!updatedPlaylistTrack.skipVotes) {
			updatedPlaylistTrack.skipVotes = [];
		}

		updatedPlaylistTrack = update(updatedPlaylistTrack, {
			skipVotes: {
				$push: [{
					userId,
					trackId
				}]
			}
		});

		updatedPlaylist[playlistIndex] = updatedPlaylistTrack;

		// check if we have enough votes to remove
		if (updatedPlaylistTrack.skipVotes.length > updatedPlaylistTrack.votes.length) {
			updatedPlaylist = update(updatedPlaylist, {$splice: [[playlistIndex, 1]]});
		}
	}

	return updatedPlaylist;
};

const ACTION_HANDLERS = {
	[ROOM_FULL_SYNC]: (state, {payload}) => ({
		/*
		 flatten out any db fields like name and id into the reduxState so we don't have
		 nested state object (like we do in the db).
		 this could probably be refactored to be easier to understand, but means
		 the client sees a single room object, but the database has reduxState separated.

		 note: new db fields added to the room have to be added here for clients to pick them up
		 */
		...state,
		...payload.fullSync.room.reduxState,
		listeners: payload.fullSync.room.listeners,
		name: payload.fullSync.room.name,
		id: payload.fullSync.room.id,
		config: payload.fullSync.room.config,
		creatorId: payload.fullSync.room.creatorId
	}),
	[ROOM_USER_JOIN]: (state, action) => {
		const {userId} = action.payload;
		const {listeners, actionLog} = state;
		if (listeners.indexOf(userId) === -1) {
			return {
				...state,
				listeners: update(listeners, {$push: [userId]}),
				actionLog: appendToActionLog({actionLog, action})
			};
		}
		return state;
	},
	[ROOM_USER_LEAVE]: (state, action) => {
		const {userId} = action.payload;
		const {listeners, actionLog} = state;
		const arrayIndex = listeners.indexOf(userId);
		if (arrayIndex > -1) {
			return {
				...state,
				listeners: update(listeners, {$splice: [[arrayIndex, 1]]}),
				actionLog: appendToActionLog({actionLog, action})
			};
		}
		return state;
	},
	[ROOM_CHAT]: (state, action) => ({
		...state,
		actionLog: appendToActionLog({actionLog: state.actionLog, action})
	}),
	[ROOM_REACTION]: (state, action) => ({
		...state,
		actionLog: appendToActionLog({actionLog: state.actionLog, action})
	}),
	[ROOM_TRACK_ADD_OR_VOTE]: (state, action) => {
		const {actionLog, playlist} = state;
		const {payload} = action;
		const newState = {
			...state,
			playlist: applyVotes({playlist, payload}),
			actionLog: payload.userId ? appendToActionLog({actionLog, action}) : actionLog
		};

		// there were no tracks before, so set the start time to the action timestamp (server now)
		if (state.playlist.length === 0) {
			newState.nowPlayingStartedAt = moment(action.timestamp).valueOf();
		}
		return newState;
	},
	[ROOM_TRACK_VOTE_SKIP]: (state, action) => {
		const {actionLog, playlist} = state;
		const {payload} = action;
		const nowPlayingTrackId = playlist.length === 0 ? null : playlist[0].id;

		let newState = {
			...state,
			playlist: applySkipVote({playlist, payload}),
			actionLog: appendToActionLog({actionLog, action})
		};

		if (newState.playlist.length === 0 || newState.playlist[0].id !== nowPlayingTrackId) {
			// the now playing track changed because of this vote, we need to keep the show going
			newState = update(newState, {
				nowPlayingStartedAt: {$set: payload.moment},
				nowPlayingProgress: {$set: 0}
			});
		}
		return newState;
	},
	[ROOM_NOW_PLAYING_ENDED]: (state, {payload}) => {
		if (state.playlist.length === 0) {
			return state;
		}

		// move playlist item to recently played
		let newState = update(state, {
				playlist: {$splice: [[0, 1]]},
				recentlyPlayed: {$push: [payload.trackWithVotes]}
			}
		);

		// remove item from recently played to size if required
		const recentLength = newState.recentlyPlayed.length;
		if (recentLength > config.playlist.recentlyPlayedMaxLength) {
			newState = update(newState, {
				recentlyPlayed: {$splice: [[0, 1]]}
			});
		}

		// set nowPlayingStartedAt to last + duration
		if (newState.playlist.length > 0) {
			newState = update(newState, {
				nowPlayingStartedAt: {$set: state.nowPlayingStartedAt + payload.finishingTrackDuration},
				nowPlayingProgress: {$set: 0}
			});
		}

		return newState;
	},
	[ROOM_TRACK_PROGRESS]: (state, {payload}) => ({
		...state,
		nowPlayingProgress: payload.nowPlayingProgress
	}),
	[SOCKET_ROOM_STATS_OK]: (state, {payload}) => ({
		...state,
		stats: payload.stats
	})
};

// ------------------------------------
// Reducer
// ------------------------------------
export default function roomReducer(state = defaultState, action) {
	const handler = ACTION_HANDLERS[action.type];
	return handler ? handler(state, action) : state;
}
