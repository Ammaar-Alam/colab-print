const DATABASE_NAME = 'colab_print';
const DATABASE_VERSION = 1;
const JOBS_STORE = 'jobs';
const SLICES_STORE = 'slices';
const SLICE_JOB_INDEX = 'by_job';

let databasePromise;

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(JOBS_STORE)) {
        database.createObjectStore(JOBS_STORE, { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains(SLICES_STORE)) {
        const slicesStore = database.createObjectStore(SLICES_STORE, {
          keyPath: ['jobId', 'index']
        });

        slicesStore.createIndex(SLICE_JOB_INDEX, 'jobId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

export async function putJob(job) {
  const database = await openDatabase();
  const transaction = database.transaction(JOBS_STORE, 'readwrite');
  transaction.objectStore(JOBS_STORE).put(job);
  await waitForTransaction(transaction);
  return job;
}

export async function getJob(jobId) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(JOBS_STORE, 'readonly');
    const request = transaction.objectStore(JOBS_STORE).get(jobId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function putSlice(jobId, slice) {
  const database = await openDatabase();
  const transaction = database.transaction(SLICES_STORE, 'readwrite');
  transaction.objectStore(SLICES_STORE).put({
    jobId,
    ...slice
  });
  await waitForTransaction(transaction);
}

export async function getSlices(jobId) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SLICES_STORE, 'readonly');
    const index = transaction.objectStore(SLICES_STORE).index(SLICE_JOB_INDEX);
    const request = index.getAll(jobId);

    request.onsuccess = () => {
      const slices = (request.result || []).sort((left, right) => left.index - right.index);
      resolve(slices);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function deleteJob(jobId) {
  const database = await openDatabase();
  const transaction = database.transaction([JOBS_STORE, SLICES_STORE], 'readwrite');
  transaction.objectStore(JOBS_STORE).delete(jobId);

  const slicesStore = transaction.objectStore(SLICES_STORE);
  const index = slicesStore.index(SLICE_JOB_INDEX);

  const sliceRecords = await new Promise((resolve, reject) => {
    const request = index.getAll(jobId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  for (const slice of sliceRecords) {
    slicesStore.delete([slice.jobId, slice.index]);
  }

  await waitForTransaction(transaction);
}
