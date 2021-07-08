export class ImageNotFound extends Error {
    name: string;
    constructor(name:string) {
        super("Docker image not found");
        this.name = name;
        Error.captureStackTrace(this, ImageNotFound);
    }
}

export class InvalidRegistry extends Error {
    registry: string;
    constructor(registry:string) {
        super("Docker registry is invalid");
        this.registry = registry;
        Error.captureStackTrace(this, InvalidRegistry);
    }
}

export class InvalidImage extends Error {
    name: string;
    constructor(name:string) {
        super("Image is invalid");
        this.name = name;
        Error.captureStackTrace(this, InvalidImage);
    }
}