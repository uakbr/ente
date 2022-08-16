import React, { useContext, useEffect, useRef, useState } from 'react';

import { syncCollections, createAlbum } from 'services/collectionService';
import constants from 'utils/strings/constants';
import UploadProgress from './UploadProgress';

import UploadStrategyChoiceModal from './UploadStrategyChoiceModal';
import { SetCollectionNamerAttributes } from '../Collections/CollectionNamer';
import { SetCollectionSelectorAttributes } from 'types/gallery';
import { GalleryContext } from 'pages/gallery';
import { AppContext } from 'pages/_app';
import { logError } from 'utils/sentry';
import UploadManager from 'services/upload/uploadManager';
import uploadManager from 'services/upload/uploadManager';
import ImportService from 'services/importService';
import isElectron from 'is-electron';
import { METADATA_FOLDER_NAME } from 'constants/export';
import { CustomError } from 'utils/error';
import { Collection } from 'types/collection';
import { SetLoading, SetFiles } from 'types/gallery';
import { ElectronFile, FileWithCollection } from 'types/upload';
import Router from 'next/router';
import { isCanvasBlocked } from 'utils/upload/isCanvasBlocked';
import { downloadApp } from 'utils/common';
import watchFolderService from 'services/watchFolder/watchFolderService';
import DiscFullIcon from '@mui/icons-material/DiscFull';
import { NotificationAttributes } from 'types/Notification';
import {
    UploadFileNames,
    UploadCounter,
    SegregatedFinishedUploads,
    InProgressUpload,
} from 'types/upload/ui';
import { UPLOAD_STAGES } from 'constants/upload';
import importService from 'services/importService';
import { getDownloadAppMessage } from 'utils/ui';
import UploadTypeSelector from './UploadTypeSelector';
import { newLock } from 'utils/common';

const FIRST_ALBUM_NAME = 'My First Album';

interface Props {
    syncWithRemote: (force?: boolean, silent?: boolean) => Promise<void>;
    closeCollectionSelector: () => void;
    setCollectionSelectorAttributes: SetCollectionSelectorAttributes;
    setCollectionNamerAttributes: SetCollectionNamerAttributes;
    setLoading: SetLoading;
    uploadInProgress: boolean;
    setUploadInProgress: (value: boolean) => void;
    showCollectionSelector: () => void;
    setFiles: SetFiles;
    isFirstUpload: boolean;
    electronFiles: ElectronFile[];
    setElectronFiles: (files: ElectronFile[]) => void;
    webFiles: File[];
    setWebFiles: (files: File[]) => void;
    uploadTypeSelectorView: boolean;
    setUploadTypeSelectorView: (open: boolean) => void;
    showSessionExpiredMessage: () => void;
    showUploadFilesDialog: () => void;
    showUploadDirsDialog: () => void;
}

export enum DESKTOP_UPLOAD_TYPE {
    FILES = 'files',
    FOLDERS = 'folders',
    ZIPS = 'zips',
}

enum UPLOAD_STRATEGY {
    SINGLE_COLLECTION,
    COLLECTION_PER_FOLDER,
}

export enum UPLOAD_TYPE {
    FILES = 'files',
    FOLDERS = 'folders',
    ZIPS = 'zips',
}

interface AnalysisResult {
    suggestedCollectionName: string;
    multipleFolders: boolean;
}

const NULL_ANALYSIS_RESULT = {
    suggestedCollectionName: '',
    multipleFolders: false,
};

export default function Uploader(props: Props) {
    const [uploadProgressView, setUploadProgressView] = useState(false);
    const [uploadStage, setUploadStage] = useState<UPLOAD_STAGES>();
    const [uploadFileNames, setUploadFileNames] = useState<UploadFileNames>();
    const [uploadCounter, setUploadCounter] = useState<UploadCounter>({
        finished: 0,
        total: 0,
    });
    const [inProgressUploads, setInProgressUploads] = useState<
        InProgressUpload[]
    >([]);
    const [finishedUploads, setFinishedUploads] =
        useState<SegregatedFinishedUploads>(new Map());
    const [percentComplete, setPercentComplete] = useState(0);
    const [hasLivePhotos, setHasLivePhotos] = useState(false);

    const [choiceModalView, setChoiceModalView] = useState(false);
    const [analysisResult, setAnalysisResult] =
        useState<AnalysisResult>(NULL_ANALYSIS_RESULT);
    const appContext = useContext(AppContext);
    const galleryContext = useContext(GalleryContext);

    const toUploadFiles = useRef<File[] | ElectronFile[]>(null);
    const isPendingDesktopUpload = useRef(false);
    const pendingDesktopUploadCollectionName = useRef<string>('');
    const uploadType = useRef<UPLOAD_TYPE>(null);
    const zipPaths = useRef<string[]>(null);
    const waitForPrevUpload = useRef<Promise<void>>(null);
    const uploadDone = useRef<() => void>(null);

    const closeUploadProgress = () => setUploadProgressView(false);

    useEffect(() => {
        UploadManager.initUploader(
            {
                setPercentComplete,
                setUploadCounter,
                setInProgressUploads,
                setFinishedUploads,
                setUploadStage,
                setUploadFilenames: setUploadFileNames,
                setHasLivePhotos,
            },
            props.setFiles
        );

        if (isElectron() && ImportService.checkAllElectronAPIsExists()) {
            ImportService.getPendingUploads().then(
                ({ files: electronFiles, collectionName, type }) => {
                    resumeDesktopUpload(type, electronFiles, collectionName);
                }
            );
            watchFolderService.init(
                props.setElectronFiles,
                setCollectionName,
                props.syncWithRemote,
                appContext.setIsFolderSyncRunning
            );
        }
    }, []);

    const setCollectionName = (collectionName: string) => {
        isPendingDesktopUpload.current = true;
        pendingDesktopUploadCollectionName.current = collectionName;
    };

    useEffect(() => {
        if (
            props.electronFiles?.length > 0 ||
            props.webFiles?.length > 0 ||
            appContext.sharedFiles?.length > 0
        ) {
            if (props.uploadInProgress) {
                if (watchFolderService.isUploadRunning()) {
                    // pause watch folder service on user upload
                    uploadManager.pauseWatchService();
                } else {
                    // no-op
                    // a user upload is already in progress
                    return;
                }
            } else if (isCanvasBlocked()) {
                appContext.setDialogMessage({
                    title: constants.CANVAS_BLOCKED_TITLE,

                    content: constants.CANVAS_BLOCKED_MESSAGE(),
                    close: { text: constants.CLOSE },
                    proceed: {
                        text: constants.DOWNLOAD,
                        action: downloadApp,
                        variant: 'accent',
                    },
                });
                return;
            }
            props.setLoading(true);
            if (props.webFiles?.length > 0) {
                // File selection by drag and drop or selection of file.
                toUploadFiles.current = props.webFiles;
                props.setWebFiles([]);
            } else if (appContext.sharedFiles?.length > 0) {
                toUploadFiles.current = appContext.sharedFiles;
                appContext.resetSharedFiles();
            } else if (props.electronFiles?.length > 0) {
                // File selection from desktop app
                toUploadFiles.current = props.electronFiles;
                props.setElectronFiles([]);
            }
            const analysisResult = analyseUploadFiles();
            setAnalysisResult(analysisResult);

            handleCollectionCreationAndUpload(
                analysisResult,
                props.isFirstUpload
            );
            props.setLoading(false);
        }
    }, [props.webFiles, appContext.sharedFiles, props.electronFiles]);

    const uploadInit = function () {
        setUploadStage(UPLOAD_STAGES.START);
        setUploadCounter({ finished: 0, total: 0 });
        setInProgressUploads([]);
        setFinishedUploads(new Map());
        setPercentComplete(0);
        props.closeCollectionSelector();
        setUploadProgressView(true);
    };

    const resumeDesktopUpload = async (
        type: UPLOAD_TYPE,
        electronFiles: ElectronFile[],
        collectionName: string
    ) => {
        if (electronFiles && electronFiles?.length > 0) {
            isPendingDesktopUpload.current = true;
            pendingDesktopUploadCollectionName.current = collectionName;
            uploadType.current = type;
            props.setElectronFiles(electronFiles);
        }
    };

    function analyseUploadFiles(): AnalysisResult {
        if (isElectron() && uploadType.current === UPLOAD_TYPE.FILES) {
            return NULL_ANALYSIS_RESULT;
        }

        const paths: string[] = toUploadFiles.current.map(
            (file) => file['path']
        );
        const getCharCount = (str: string) => (str.match(/\//g) ?? []).length;
        paths.sort((path1, path2) => getCharCount(path1) - getCharCount(path2));
        const firstPath = paths[0];
        const lastPath = paths[paths.length - 1];

        const L = firstPath.length;
        let i = 0;
        const firstFileFolder = firstPath.substring(
            0,
            firstPath.lastIndexOf('/')
        );
        const lastFileFolder = lastPath.substring(0, lastPath.lastIndexOf('/'));
        while (i < L && firstPath.charAt(i) === lastPath.charAt(i)) i++;
        let commonPathPrefix = firstPath.substring(0, i);

        if (commonPathPrefix) {
            commonPathPrefix = commonPathPrefix.substring(
                0,
                commonPathPrefix.lastIndexOf('/')
            );
            if (commonPathPrefix) {
                commonPathPrefix = commonPathPrefix.substring(
                    commonPathPrefix.lastIndexOf('/') + 1
                );
            }
        }
        return {
            suggestedCollectionName: commonPathPrefix || null,
            multipleFolders: firstFileFolder !== lastFileFolder,
        };
    }
    function getCollectionWiseFiles() {
        const collectionWiseFiles = new Map<string, (File | ElectronFile)[]>();
        for (const file of toUploadFiles.current) {
            const filePath = file['path'] as string;

            let folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
            if (folderPath.endsWith(METADATA_FOLDER_NAME)) {
                folderPath = folderPath.substring(
                    0,
                    folderPath.lastIndexOf('/')
                );
            }
            const folderName = folderPath.substring(
                folderPath.lastIndexOf('/') + 1
            );
            if (!collectionWiseFiles.has(folderName)) {
                collectionWiseFiles.set(folderName, []);
            }
            collectionWiseFiles.get(folderName).push(file);
        }
        return collectionWiseFiles;
    }

    const uploadFilesToExistingCollection = async (collection: Collection) => {
        try {
            const filesWithCollectionToUpload: FileWithCollection[] =
                toUploadFiles.current.map((file, index) => ({
                    file,
                    localID: index,
                    collectionID: collection.id,
                }));
            await uploadFiles(filesWithCollectionToUpload, [collection]);
        } catch (e) {
            logError(e, 'Failed to upload files to existing collections');
        }
    };

    const uploadFilesToNewCollections = async (
        strategy: UPLOAD_STRATEGY,
        collectionName?: string
    ) => {
        try {
            const filesWithCollectionToUpload: FileWithCollection[] = [];
            const collections: Collection[] = [];
            let collectionWiseFiles = new Map<
                string,
                (File | ElectronFile)[]
            >();
            if (strategy === UPLOAD_STRATEGY.SINGLE_COLLECTION) {
                collectionWiseFiles.set(collectionName, toUploadFiles.current);
            } else {
                collectionWiseFiles = getCollectionWiseFiles();
            }
            try {
                const existingCollection = await syncCollections();
                let index = 0;
                for (const [collectionName, files] of collectionWiseFiles) {
                    const collection = await createAlbum(
                        collectionName,
                        existingCollection
                    );
                    collections.push(collection);

                    filesWithCollectionToUpload.push(
                        ...files.map((file) => ({
                            localID: index++,
                            collectionID: collection.id,
                            file,
                        }))
                    );
                }
            } catch (e) {
                closeUploadProgress();
                logError(e, 'Failed to create album');
                appContext.setDialogMessage({
                    title: constants.ERROR,

                    close: { variant: 'danger' },
                    content: constants.CREATE_ALBUM_FAILED,
                });
                throw e;
            }
            await uploadFiles(filesWithCollectionToUpload, collections);
        } catch (e) {
            logError(e, 'Failed to upload files to new collections');
        }
    };

    const uploadFiles = async (
        filesWithCollectionToUpload: FileWithCollection[],
        collections: Collection[]
    ) => {
        try {
            if (waitForPrevUpload.current !== null) {
                await waitForPrevUpload.current; // wait for previous upload to finish
            }
            setUploadLock();
            uploadInit();
            props.setUploadInProgress(true);
            props.closeCollectionSelector();
            await props.syncWithRemote(true, true);
            if (isElectron() && !isPendingDesktopUpload.current) {
                await ImportService.setToUploadCollection(collections);
                if (zipPaths.current) {
                    await ImportService.setToUploadFiles(
                        UPLOAD_TYPE.ZIPS,
                        zipPaths.current
                    );
                    zipPaths.current = null;
                }
                await ImportService.setToUploadFiles(
                    UPLOAD_TYPE.FILES,
                    filesWithCollectionToUpload.map(
                        ({ file }) => (file as ElectronFile).path
                    )
                );
            }
            await uploadManager.queueFilesForUpload(
                filesWithCollectionToUpload,
                collections
            );
        } catch (err) {
            showUserFacingError(err.message);
            closeUploadProgress();
            throw err;
        } finally {
            unsetUploadLock();
            props.setUploadInProgress(false);
            props.syncWithRemote();
            if (isElectron()) {
                if (watchFolderService.isUploadRunning()) {
                    await watchFolderService.allFileUploadsDone(
                        filesWithCollectionToUpload,
                        collections
                    );
                } else {
                    if (watchFolderService.isServicePaused()) {
                        // resume the service after user upload is done
                        watchFolderService.resumeService();
                    }
                }
            }
        }
    };

    const setUploadLock = () => {
        const { wait, unlock } = newLock();
        waitForPrevUpload.current = wait;
        uploadDone.current = unlock;
    };

    const unsetUploadLock = () => {
        uploadDone.current();
        waitForPrevUpload.current = null;
    };

    const retryFailed = async () => {
        try {
            props.setUploadInProgress(true);
            uploadInit();
            await props.syncWithRemote(true, true);
            await uploadManager.retryFailedFiles();
        } catch (err) {
            showUserFacingError(err.message);

            closeUploadProgress();
        } finally {
            props.setUploadInProgress(false);
            props.syncWithRemote();
        }
    };

    function showUserFacingError(err: CustomError) {
        let notification: NotificationAttributes;
        switch (err) {
            case CustomError.SESSION_EXPIRED:
                return props.showSessionExpiredMessage();
            case CustomError.SUBSCRIPTION_EXPIRED:
                notification = {
                    variant: 'danger',
                    message: constants.SUBSCRIPTION_EXPIRED,
                    action: {
                        text: constants.UPGRADE_NOW,
                        callback: galleryContext.showPlanSelectorModal,
                    },
                };
                break;
            case CustomError.STORAGE_QUOTA_EXCEEDED:
                notification = {
                    variant: 'danger',
                    message: constants.STORAGE_QUOTA_EXCEEDED,
                    action: {
                        text: constants.RENEW_NOW,
                        callback: galleryContext.showPlanSelectorModal,
                    },
                    icon: <DiscFullIcon fontSize="large" />,
                };
                break;
            default:
                notification = {
                    variant: 'danger',
                    message: constants.UNKNOWN_ERROR,
                };
        }
        galleryContext.setNotificationAttributes(notification);
    }

    const uploadToSingleNewCollection = (collectionName: string) => {
        if (collectionName) {
            uploadFilesToNewCollections(
                UPLOAD_STRATEGY.SINGLE_COLLECTION,
                collectionName
            );
        } else {
            showCollectionCreateModal();
        }
    };
    const showCollectionCreateModal = () => {
        props.setCollectionNamerAttributes({
            title: constants.CREATE_COLLECTION,
            buttonText: constants.CREATE,
            autoFilledName: null,
            callback: uploadToSingleNewCollection,
        });
    };

    const handleCollectionCreationAndUpload = (
        analysisResult: AnalysisResult,
        isFirstUpload: boolean
    ) => {
        if (isPendingDesktopUpload.current) {
            isPendingDesktopUpload.current = false;
            if (pendingDesktopUploadCollectionName.current) {
                uploadToSingleNewCollection(
                    pendingDesktopUploadCollectionName.current
                );
                pendingDesktopUploadCollectionName.current = null;
            } else {
                uploadFilesToNewCollections(
                    UPLOAD_STRATEGY.COLLECTION_PER_FOLDER
                );
            }
            return;
        }
        if (isElectron() && uploadType.current === UPLOAD_TYPE.ZIPS) {
            uploadFilesToNewCollections(UPLOAD_STRATEGY.COLLECTION_PER_FOLDER);
            return;
        }
        if (isFirstUpload && !analysisResult.suggestedCollectionName) {
            analysisResult.suggestedCollectionName = FIRST_ALBUM_NAME;
        }
        let showNextModal = () => {};
        if (analysisResult.multipleFolders) {
            showNextModal = () => setChoiceModalView(true);
        } else {
            showNextModal = () =>
                uploadToSingleNewCollection(
                    analysisResult.suggestedCollectionName
                );
        }
        props.setCollectionSelectorAttributes({
            callback: uploadFilesToExistingCollection,
            showNextModal,
            title: constants.UPLOAD_TO_COLLECTION,
        });
    };
    const handleDesktopUpload = async (type: UPLOAD_TYPE) => {
        let files: ElectronFile[];
        uploadType.current = type;
        if (type === UPLOAD_TYPE.FILES) {
            files = await ImportService.showUploadFilesDialog();
        } else if (type === UPLOAD_TYPE.FOLDERS) {
            files = await ImportService.showUploadDirsDialog();
        } else {
            const response = await ImportService.showUploadZipDialog();
            files = response.files;
            zipPaths.current = response.zipPaths;
        }
        if (files?.length > 0) {
            props.setElectronFiles(files);
            props.setUploadTypeSelectorView(false);
        }
    };

    const handleWebUpload = async (type: UPLOAD_TYPE) => {
        uploadType.current = type;
        if (type === UPLOAD_TYPE.FILES) {
            props.showUploadFilesDialog();
        } else if (type === UPLOAD_TYPE.FOLDERS) {
            props.showUploadDirsDialog();
        } else {
            appContext.setDialogMessage(getDownloadAppMessage());
        }
    };

    const cancelUploads = async () => {
        closeUploadProgress();
        if (isElectron()) {
            ImportService.cancelRemainingUploads();
        }
        props.setUploadInProgress(false);
        Router.reload();
    };

    const handleUpload = (type) => () => {
        if (isElectron() && importService.checkAllElectronAPIsExists()) {
            handleDesktopUpload(type);
        } else {
            handleWebUpload(type);
        }
    };

    const handleFileUpload = handleUpload(UPLOAD_TYPE.FILES);
    const handleFolderUpload = handleUpload(UPLOAD_TYPE.FOLDERS);
    const handleZipUpload = handleUpload(UPLOAD_TYPE.ZIPS);
    const closeUploadTypeSelector = () =>
        props.setUploadTypeSelectorView(false);

    return (
        <>
            <UploadStrategyChoiceModal
                open={choiceModalView}
                onClose={() => setChoiceModalView(false)}
                uploadToSingleCollection={() =>
                    uploadToSingleNewCollection(
                        analysisResult.suggestedCollectionName
                    )
                }
                uploadToMultipleCollection={() =>
                    uploadFilesToNewCollections(
                        UPLOAD_STRATEGY.COLLECTION_PER_FOLDER
                    )
                }
            />
            <UploadTypeSelector
                show={props.uploadTypeSelectorView}
                onHide={closeUploadTypeSelector}
                uploadFiles={handleFileUpload}
                uploadFolders={handleFolderUpload}
                uploadGoogleTakeoutZips={handleZipUpload}
            />
            <UploadProgress
                open={uploadProgressView}
                onClose={closeUploadProgress}
                percentComplete={percentComplete}
                uploadFileNames={uploadFileNames}
                uploadCounter={uploadCounter}
                uploadStage={uploadStage}
                inProgressUploads={inProgressUploads}
                hasLivePhotos={hasLivePhotos}
                retryFailed={retryFailed}
                finishedUploads={finishedUploads}
                cancelUploads={cancelUploads}
            />
        </>
    );
}
