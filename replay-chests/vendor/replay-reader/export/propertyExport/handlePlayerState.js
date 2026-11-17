const handlePlayerPawn = require("./handlePlayerPawn");

// Patched: the spectator list is kept per replay (keyed by `states`) instead of one
// module-level list, which leaked between replays parsed in the same process.
const spectatorsByStates = new WeakMap();

const handleQueuedPlayerPawns = (stateChIndex, states, globalData) => {
  const actorId = globalData.channelToActor[stateChIndex];

  if (!actorId) {
    return;
  }

  const playerPawns = states.queuedPlayerPawns[actorId];

  if (!playerPawns) {
    return;
  }

  playerPawns.forEach((playerPawn) => {
    handlePlayerPawn({
      chIndex: playerPawn.chIndex,
      data: playerPawn.playerPawn,
      changedProperties: playerPawn.changedProperties,
      states,
      globalData,
    })
  });
};

const handlePlayerState = ({ chIndex, data, states, result, globalData, changedProperties }) => {
  if (!spectatorsByStates.has(states)) {
    spectatorsByStates.set(states, []);
  }

  const onlySpectatingPlayers = spectatorsByStates.get(states);

  if (data.bOnlySpectator == true) {
    onlySpectatingPlayers.push(chIndex);
    return;
  }

  if (onlySpectatingPlayers.includes(chIndex)) {
    return;
  }

  let playerData = states.players[chIndex];

  let newPlayer = false;

  if (!playerData) {
    playerData = data;
    states.players[chIndex] = playerData;
    result.gameData.players.push(playerData);
    newPlayer = true;
  }

  for (let i = 0; i < changedProperties.length; i += 1) {
    const key = changedProperties[i];

    playerData[key] = data[key];
  }

  if (!playerData.bIsABot && data.PlayerNamePrivate) {
    const name = data.PlayerNamePrivate;

    playerData.PlayerNamePrivate = name.split('').map((a, i) => String.fromCharCode(a.charCodeAt() + ((name.length % 4 * 3 % 8 + 1 + i) * 3 % 8))).join('')
  }

  if (newPlayer) {
    handleQueuedPlayerPawns(chIndex, states, globalData);
  }
};

module.exports = handlePlayerState;
