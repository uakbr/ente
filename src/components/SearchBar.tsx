import { SetCollections, SetFiles } from 'pages/gallery';
import React, { useEffect, useState, useRef } from 'react';
import styled from 'styled-components';
import AsyncSelect from 'react-select/async';
import { components } from 'react-select';
import { useDebouncedCallback } from 'use-debounce';
import { File, getLocalFiles } from 'services/fileService';
import {
    Collection,
    getLocalCollections,
    getNonEmptyCollections,
} from 'services/collectionService';
import { Bbox, parseHumanDate, searchLocation } from 'services/searchService';
import { getFilesWithCreationDay, getFilesInsideBbox } from 'utils/search';
import constants from 'utils/strings/constants';
import { formatDate } from 'utils/common';
import LocationIcon from './LocationIcon';
import DateIcon from './DateIcon';

const Wrapper = styled.div<{ open: boolean }>`
    background-color: #111;
    color: #fff;
    min-height: 64px;
    align-items: center;
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.7);
    margin-bottom: 10px;
    position: fixed;
    top: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 0 20%;
    display: ${(props) => (props.open ? 'flex' : 'none')};
`;

enum SearchType {
    DATE,
    LOCATION,
}
interface SearchParams {
    type: SearchType;
    label: string;
    value: Bbox | Date;
}
interface Props {
    isOpen: boolean;
    setOpen: (value) => void;
    loadingBar: any;
    setFiles: SetFiles;
    setCollections: SetCollections;
}
export default function SearchBar(props: Props) {
    const [allFiles, setAllFiles] = useState<File[]>([]);
    const [allCollections, setAllCollections] = useState<Collection[]>([]);

    useEffect(() => {
        const main = async () => {
            setAllFiles(await getLocalFiles());
            setAllCollections(await getLocalCollections());
        };
        main();
    }, []);

    const searchBarRef = useRef(null);
    useEffect(() => {
        if (props.isOpen) {
            setTimeout(() => {
                searchBarRef.current?.focus();
            }, 200);
        }
    }, [props.isOpen]);

    const getAutoCompleteSuggestion = async (searchPhrase: string) => {
        const searchedDate = parseHumanDate(searchPhrase);
        let option = new Array<SearchParams>();
        if (searchedDate != null) {
            option.push({
                type: SearchType.DATE,
                value: searchedDate,
                label: formatDate(searchedDate),
            });
        }
        const searchResults = await searchLocation(searchPhrase);
        option.push(
            ...searchResults.map(
                (searchResult) =>
                    ({
                        type: SearchType.LOCATION,
                        value: searchResult.bbox,
                        label: searchResult.placeName,
                    } as SearchParams)
            )
        );
        return option;
    };

    const filterFiles = (selectedOption: SearchParams) => {
        if (!selectedOption) {
            return;
        }
        let resultFiles: File[] = [];

        switch (selectedOption.type) {
            case SearchType.DATE:
                const searchedDate = selectedOption.value as Date;
                const filesWithSameDate = getFilesWithCreationDay(
                    allFiles,
                    searchedDate
                );
                console.log(filesWithSameDate);
                resultFiles = filesWithSameDate;
            case SearchType.LOCATION:
                const bbox = selectedOption.value as Bbox;

                const filesTakenAtLocation = getFilesInsideBbox(allFiles, bbox);
                resultFiles = filesTakenAtLocation;
        }

        props.setFiles(resultFiles);
        props.setCollections(
            getNonEmptyCollections(allCollections, resultFiles)
        );
    };
    const closeSearchBar = ({ resetForm }) => {
        props.setOpen(false);
        props.setFiles(allFiles);
        props.setCollections(allCollections);
        resetForm();
    };

    const getIconByType = (type: SearchType) => (
        <span style={{ marginRight: '5px' }}>
            {type === SearchType.DATE ? <DateIcon /> : <LocationIcon />}
        </span>
    );
    const { Option, SingleValue } = components;
    const SingleValueWithIcon = (props) => (
        <SingleValue {...props}>
            {getIconByType(props.data.type)}
            {props.data.label}
        </SingleValue>
    );
    const OptionWithIcon = (props) => (
        <Option {...props}>
            {getIconByType(props.data.type)}
            {props.data.label}
        </Option>
    );

    const customStyles = {
        control: (provided, { isFocused }) => ({
            ...provided,
            backgroundColor: '#282828',
            color: '#d1d1d1',
            borderColor: isFocused && '#2dc262',
            boxShadow: isFocused && '0 0 3px #2dc262',
            ':hover': {
                borderColor: '#2dc262',
            },
        }),
        input: (provided) => ({
            ...provided,
            color: '#d1d1d1',
        }),
        menu: (provided) => ({
            ...provided,
            backgroundColor: '#282828',
        }),
        option: (provided, { isFocused }) => ({
            ...provided,
            backgroundColor: isFocused && '#343434',
        }),
        dropdownIndicator: (provided) => ({
            ...provided,
            display: 'none',
        }),
        indicatorSeparator: (provided) => ({
            ...provided,
            display: 'none',
        }),
        clearIndicator: (provided) => ({
            ...provided,
            ':hover': { color: '#d2d2d2' },
        }),
        singleValue: (provided, state) => ({
            ...provided,
            backgroundColor: '#282828',
            color: '#d1d1d1',
        }),
    };

    const getOptions = useDebouncedCallback(getAutoCompleteSuggestion, 250);

    return (
        <Wrapper open={props.isOpen}>
            <>
                <div
                    style={{
                        flex: 1,
                        maxWidth: '600px',
                        margin: '10px',
                    }}
                >
                    <AsyncSelect
                        components={{
                            Option: OptionWithIcon,
                            SingleValue: SingleValueWithIcon,
                        }}
                        cacheOptions
                        ref={searchBarRef}
                        placeholder={constants.SEARCH_HINT}
                        loadOptions={getOptions}
                        onChange={filterFiles}
                        isClearable
                        styles={customStyles}
                        noOptionsMessage={() => null}
                    />
                </div>
                <div
                    style={{
                        margin: '0',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                    }}
                    onClick={() => closeSearchBar({ resetForm: () => null })}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        height={25}
                        viewBox={`0 0 25 25`}
                        width={25}
                    >
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"></path>
                    </svg>
                </div>
            </>
        </Wrapper>
    );
}
