export const binarySearch = function <T>(array: Array<T>, value: T): boolean {
  const search = (start: number, end: number): boolean => {
    const range: number = end - start;
    const index: number = Math.floor(start + range / 2);
    const arrayValue: T = array[index]!;

    if (arrayValue === value) {
      return true;
    }

    if (start === index) {
      return false;
    }

    if (value < arrayValue) {
      end = index;
    }

    if (value > arrayValue) {
      start = index;
    }

    return search(start, end);
  };

  return search(0, array.length);
};
