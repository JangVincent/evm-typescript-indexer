export async function sleep(s : number) {
  return new Promise((resolve) => {
    setTimeout(resolve, 1000 * s);
  });
}
