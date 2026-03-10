type CharacterLike = {
  id: string;
  isMainCharacter: boolean;
};

export function upsertMainCharacter<T extends CharacterLike>(
  characters: T[],
  mainCharacter: T,
) {
  const companions = characters.filter((character) => !character.isMainCharacter);
  return [mainCharacter, ...companions];
}
